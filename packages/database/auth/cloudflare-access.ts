import crypto from "node:crypto";

/**
 * Cloudflare Access identity bridge.
 *
 * When ScreenShare is published through the Cloudflare tunnel, Zero Trust
 * authenticates the visitor at the edge and forwards a signed JWT in the
 * `Cf-Access-Jwt-Assertion` header. We verify that JWT against the team's
 * public keys rather than trusting the plaintext `Cf-Access-Authenticated-User-Email`
 * header, because the container also listens on localhost — an unverified
 * header would let anything that can reach the port impersonate any user.
 *
 * A verified assertion is the app's source of identity on public hostnames,
 * which is what makes per-person team accounts possible without ScreenShare
 * ever handling a password.
 */

export interface AccessIdentity {
	email: string;
	subject: string;
}

interface JsonWebKey {
	kid?: string;
	kty?: string;
	alg?: string;
	n?: string;
	e?: string;
}

const JWKS_CACHE_TTL_MS = 5 * 60 * 1000;
const CLOCK_SKEW_SECONDS = 60;

let jwksCache: { teamDomain: string; keys: JsonWebKey[]; expiresAt: number } | null =
	null;

/** Accepts either `acme` or `acme.cloudflareaccess.com`. */
export function accessTeamDomain(): string | null {
	const raw = process.env.CLOUDFLARE_ACCESS_TEAM_DOMAIN?.trim();
	if (!raw) return null;

	const withoutScheme = raw.replace(/^https?:\/\//, "").replace(/\/+$/, "");
	if (!withoutScheme) return null;

	return withoutScheme.includes(".")
		? withoutScheme
		: `${withoutScheme}.cloudflareaccess.com`;
}

function allowedAudiences(): string[] {
	return (process.env.CLOUDFLARE_ACCESS_AUD ?? "")
		.split(",")
		.map((value) => value.trim())
		.filter(Boolean);
}

export function accessIsConfigured(): boolean {
	return Boolean(accessTeamDomain()) && allowedAudiences().length > 0;
}

function base64UrlDecode(segment: string): Buffer {
	return Buffer.from(segment.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function parseJsonSegment<T>(segment: string): T | null {
	try {
		return JSON.parse(base64UrlDecode(segment).toString("utf8")) as T;
	} catch {
		return null;
	}
}

async function fetchSigningKeys(teamDomain: string): Promise<JsonWebKey[]> {
	if (
		jwksCache &&
		jwksCache.teamDomain === teamDomain &&
		jwksCache.expiresAt > Date.now()
	) {
		return jwksCache.keys;
	}

	const response = await fetch(
		`https://${teamDomain}/cdn-cgi/access/certs`,
		// The certs endpoint is public; no credentials should ever be attached.
		{ cache: "no-store" },
	);

	if (!response.ok) {
		throw new Error(
			`Cloudflare Access certs request failed: ${response.status}`,
		);
	}

	const body = (await response.json()) as { keys?: JsonWebKey[] };
	const keys = body.keys ?? [];

	jwksCache = { teamDomain, keys, expiresAt: Date.now() + JWKS_CACHE_TTL_MS };

	return keys;
}

/**
 * Verifies a Cloudflare Access application token.
 *
 * Returns `null` for anything that is not a currently-valid assertion for this
 * application — malformed tokens, unknown signing keys, bad signatures, the
 * wrong audience, and expired or not-yet-valid tokens all fail closed.
 */
export async function verifyAccessJwt(
	token: string | null | undefined,
): Promise<AccessIdentity | null> {
	if (!token) return null;

	const teamDomain = accessTeamDomain();
	const audiences = allowedAudiences();
	if (!teamDomain || audiences.length === 0) return null;

	const [headerSegment, payloadSegment, signatureSegment] = token.split(".");
	if (!headerSegment || !payloadSegment || !signatureSegment) return null;

	const header = parseJsonSegment<{ alg?: string; kid?: string }>(
		headerSegment,
	);
	// Cloudflare Access signs with RS256. Pinning the algorithm prevents an
	// attacker from downgrading to `none` or to an HMAC keyed on public material.
	if (!header || header.alg !== "RS256" || !header.kid) return null;

	const payload = parseJsonSegment<{
		aud?: string | string[];
		email?: string;
		exp?: number;
		iat?: number;
		iss?: string;
		nbf?: number;
		sub?: string;
	}>(payloadSegment);
	if (!payload) return null;

	if (payload.iss !== `https://${teamDomain}`) return null;

	const tokenAudiences = Array.isArray(payload.aud)
		? payload.aud
		: payload.aud
			? [payload.aud]
			: [];
	if (!tokenAudiences.some((aud) => audiences.includes(aud))) return null;

	const now = Math.floor(Date.now() / 1000);
	if (typeof payload.exp !== "number" || payload.exp + CLOCK_SKEW_SECONDS < now)
		return null;
	if (typeof payload.nbf === "number" && payload.nbf - CLOCK_SKEW_SECONDS > now)
		return null;

	const email = payload.email?.trim().toLowerCase();
	if (!email) return null;

	let keys: JsonWebKey[];
	try {
		keys = await fetchSigningKeys(teamDomain);
	} catch (error) {
		console.error("[cloudflare-access] failed to fetch signing keys:", error);
		return null;
	}

	const jwk = keys.find((key) => key.kid === header.kid);
	if (!jwk || jwk.kty !== "RSA" || !jwk.n || !jwk.e) return null;

	let verified = false;
	try {
		const publicKey = crypto.createPublicKey({
			key: { kty: "RSA", n: jwk.n, e: jwk.e },
			format: "jwk",
		});

		verified = crypto.verify(
			"RSA-SHA256",
			Buffer.from(`${headerSegment}.${payloadSegment}`),
			publicKey,
			base64UrlDecode(signatureSegment),
		);
	} catch (error) {
		console.error("[cloudflare-access] signature verification error:", error);
		return null;
	}

	if (!verified) return null;

	return { email, subject: payload.sub ?? email };
}

/** Header name Cloudflare Access uses for the application token. */
export const ACCESS_JWT_HEADER = "cf-access-jwt-assertion";

/**
 * Cookie Access sets alongside the header, carrying the same signed token.
 *
 * Bypass destinations are never evaluated for identity, so Cloudflare sends no
 * assertion header on them — but the browser still sends this cookie. Share
 * pages resolve their media through bypassed routes, so without reading the
 * cookie a signed-in owner or team member looks anonymous there and cannot play
 * a recording that is not public. The token is verified exactly as the header
 * is, so accepting it weakens nothing.
 */
export const ACCESS_JWT_COOKIE = "CF_Authorization";
