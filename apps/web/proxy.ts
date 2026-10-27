import { db } from "@cap/database";
import { organizations } from "@cap/database/schema";
import { buildEnv, serverEnv } from "@cap/env";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { type NextRequest, NextResponse, userAgent } from "next/server";

const addHttps = (s?: string) => {
	if (!s) return s;
	return `https://${s}`;
};

const mainOrigins = [
	"https://cap.so",
	"https://cap.link",
	"http://localhost",
	serverEnv().WEB_URL,
	addHttps(serverEnv().VERCEL_URL_HOST),
	addHttps(serverEnv().VERCEL_BRANCH_URL_HOST),
	addHttps(serverEnv().VERCEL_PROJECT_PRODUCTION_URL_HOST),
].filter(Boolean) as string[];

/**
 * Requests that arrive directly on the machine running the stack, rather than
 * through the Cloudflare tunnel. cloudflared forwards the original `Host`, so a
 * tunnelled request never matches.
 */
function isLocalRequest(request: NextRequest) {
	const extraHosts = (process.env.SCREENSHARE_LOCAL_HOSTS ?? "")
		.split(",")
		.map((value) => value.trim().toLowerCase())
		.filter(Boolean);

	const hostname = (request.headers.get("host") ?? "")
		.toLowerCase()
		.replace(/:\d+$/, "")
		.replace(/^\[/, "")
		.replace(/\]$/, "");

	return (
		hostname === "localhost" ||
		hostname === "127.0.0.1" ||
		hostname === "::1" ||
		extraHosts.includes(hostname)
	);
}

export async function proxy(request: NextRequest) {
	const url = new URL(request.url);
	const path = url.pathname;

	// The passwordless owner bypass only applies on this machine. Applying it to
	// tunnelled requests would hand an owner session to every visitor.
	const ownerBypass =
		process.env.SCREENSHARE_DISABLE_AUTH === "true" && isLocalRequest(request);

	// Presence only — the assertion is cryptographically verified in
	// `getCurrentUser`. Routing on it is safe because the destination page still
	// resolves identity for itself.
	const hasAccessAssertion = request.headers.has("cf-access-jwt-assertion");

	if ((ownerBypass || hasAccessAssertion) && path === "/") {
		return NextResponse.redirect(new URL("/dashboard/caps", url.origin));
	}

	// Deliberately not extended to Access requests: an unverifiable assertion
	// would bounce between /login and /dashboard forever.
	if (ownerBypass && path.startsWith("/login")) {
		return NextResponse.redirect(new URL("/dashboard/caps", url.origin));
	}

	if (path === "/" && request.cookies.has("next-auth.session-token")) {
		return NextResponse.redirect(new URL("/dashboard/caps", url.origin));
	}

	if (path.startsWith("/login")) {
		const response = NextResponse.next();
		response.headers.set("X-Frame-Options", "SAMEORIGIN");
		response.headers.set(
			"Content-Security-Policy",
			"frame-ancestors https://cap.so",
		);
		return response;
	}

	const hostname = url.hostname;

	if (buildEnv.NEXT_PUBLIC_IS_CAP !== "true") {
		// Files from `public/` (recorder sounds, logos, fonts, web workers) are
		// not covered by the matcher's exclusions, so without this they 307 to
		// /login on self-hosted builds and silently fail to load.
		const isPublicFile = /\/[^/]+\.[a-z0-9]{2,5}$/i.test(path);
		if (
			!(
				isPublicFile ||
				path.startsWith("/s/") ||
				path.startsWith("/c/") ||
				path.startsWith("/middleware") ||
				path.startsWith("/dashboard") ||
				path.startsWith("/onboarding") ||
				path.startsWith("/api") ||
				path.startsWith("/login") ||
				path.startsWith("/signup") ||
				path.startsWith("/invite") ||
				path.startsWith("/self-hosting") ||
				path.startsWith("/download") ||
				path.startsWith("/terms") ||
				path.startsWith("/verify-otp") ||
				// Sets the light/dark theme before first paint. Not in the
				// allowlist it would 307 to /login on the public hostname, which
				// clients see as a flash of the wrong theme on every share page.
				path === "/theme-script.js"
			) &&
			process.env.NODE_ENV !== "development"
		)
			return NextResponse.redirect(new URL("/login", url.origin));
		else return NextResponse.next();
	}

	if (mainOrigins.some((d) => url.origin.startsWith(d))) {
		return NextResponse.next();
	}

	const webUrl = new URL(serverEnv().WEB_URL).hostname;

	try {
		if (!(path.startsWith("/s/") || path.startsWith("/c/"))) {
			const url = new URL(request.url);
			url.hostname = webUrl;
			return NextResponse.redirect(url);
		}

		const verifiedDomain = request.cookies.get("verified_domain");
		if (verifiedDomain?.value === hostname) return NextResponse.next();

		const [organization] = await db()
			.select()
			.from(organizations)
			.where(eq(organizations.customDomain, hostname));

		if (!organization || !organization.domainVerified) {
			const url = new URL(request.url);
			url.hostname = webUrl;
			return NextResponse.redirect(url);
		}

		const response = NextResponse.next();
		response.cookies.set("verified_domain", hostname, {
			httpOnly: true,
			secure: process.env.NODE_ENV === "production",
			sameSite: "strict",
			maxAge: 3600,
		});

		const { pathname } = request.nextUrl;
		const referrer = request.headers.get("referer") || "";

		const ua = userAgent(request);

		response.headers.set("x-pathname", pathname);
		response.headers.set("x-referrer", referrer);
		response.headers.set("x-user-agent", JSON.stringify(ua));

		return response;
	} catch (error) {
		console.error("Error in proxy:", error);
		return notFound();
	}
}

export const config = {
	matcher: [
		// `.well-known` is excluded so the Workflow DevKit runtime endpoint
		// (`/.well-known/workflow/v1/step`) is never rewritten to `/login` on
		// self-hosted deployments. Without this, every "use workflow" step —
		// video processing, transcription, Loom import — is silently swallowed
		// by a 307 and recordings stay stuck on "Optimizing video" forever.
		"/((?!api|.well-known|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
	],
};
