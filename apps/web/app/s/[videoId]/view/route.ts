import { db } from "@cap/database";
import { getCurrentUser } from "@cap/database/auth/session";
import { nanoId } from "@cap/database/helpers";
import { videos, videoViews } from "@cap/database/schema";
import { provideOptionalAuth, VideosPolicy } from "@cap/web-backend";
import { Policy, Video } from "@cap/web-domain";
import { and, eq, sql } from "drizzle-orm";
import { Effect, Exit } from "effect";
import UAParser from "ua-parser-js";
import { getAnonymousName } from "@/lib/anonymous-names";
import { createAnonymousViewNotification } from "@/lib/Notification";
import * as EffectRuntime from "@/lib/server";
import {
	mergeBuckets,
	rangesToBuckets,
	sanitizeWatchRanges,
} from "@/lib/video-insights";
import { getViewerIdentity } from "@/lib/viewer-identity-cookie";

type ViewEvent = "start" | "progress" | "cta";

const MAX_WATCH_DELTA_SECONDS = 120;
const MAX_DURATION_SECONDS = 24 * 60 * 60;

const text = (value: unknown, max: number) =>
	typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;

const headerText = (request: Request, names: string[], max: number) => {
	for (const name of names) {
		const raw = request.headers.get(name);
		if (!raw || raw === "XX" || raw === "T1") continue;
		try {
			return decodeURIComponent(raw).slice(0, max);
		} catch {
			return raw.slice(0, max);
		}
	}
	return null;
};

const finiteNumber = (value: unknown, min: number, max: number) =>
	typeof value === "number" && Number.isFinite(value)
		? Math.min(max, Math.max(min, value))
		: null;

export async function POST(
	request: Request,
	props: RouteContext<"/s/[videoId]/view">,
) {
	const { videoId: rawVideoId } = await props.params;
	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const event = body.event as ViewEvent;
	if (event !== "start" && event !== "progress" && event !== "cta") {
		return Response.json({ error: "Unknown event" }, { status: 400 });
	}
	const sessionId = text(body.sessionId, 128);
	if (!sessionId || sessionId === "anonymous") {
		return Response.json({ error: "sessionId is required" }, { status: 400 });
	}

	const videoId = Video.VideoId.make(rawVideoId);
	const exit = await Effect.gen(function* () {
		const videosPolicy = yield* VideosPolicy;
		return yield* Effect.promise(() =>
			db()
				.select({ id: videos.id, ownerId: videos.ownerId })
				.from(videos)
				.where(eq(videos.id, videoId))
				.limit(1),
		).pipe(Policy.withPublicPolicy(videosPolicy.canView(videoId)));
	}).pipe(provideOptionalAuth, EffectRuntime.runPromiseExit);

	if (Exit.isFailure(exit) || !exit.value[0]) {
		return Response.json({ error: "Video not found" }, { status: 404 });
	}
	const video = exit.value[0];

	const user = await getCurrentUser();
	if (user?.id === video.ownerId) {
		return Response.json({ skipped: true });
	}

	const identity = await getViewerIdentity();
	const ua = new UAParser(request.headers.get("user-agent") ?? undefined);
	const country = headerText(
		request,
		["cf-ipcountry", "x-vercel-ip-country"],
		64,
	);
	const city = headerText(request, ["cf-ipcity", "x-vercel-ip-city"], 128);

	const viewKey = and(
		eq(videoViews.videoId, videoId),
		eq(videoViews.sessionId, sessionId),
	);

	const viewerName = identity?.name ?? user?.name ?? null;
	const viewerEmail = identity?.email ?? user?.email ?? null;

	await db()
		.insert(videoViews)
		.values({
			id: nanoId(),
			videoId,
			sessionId,
			viewerKey: text(body.viewerKey, 64),
			viewerUserId: user?.id ?? null,
			viewerName,
			viewerEmail,
			country,
			city,
			browser: text(ua.getBrowser().name, 64),
			os: text(ua.getOS().name, 64),
			device: text(ua.getDevice().type ?? "desktop", 32),
			referrer: text(body.referrer, 512),
		})
		.onDuplicateKeyUpdate({
			set: {
				updatedAt: sql`now()`,
				...(viewerEmail ? { viewerName, viewerEmail } : {}),
				...(user ? { viewerUserId: user.id } : {}),
			},
		});

	if (event === "start") {
		if (!user) {
			const location =
				city && country ? `${city}, ${country}` : (city ?? country);
			await createAnonymousViewNotification({
				videoId,
				// An identified viewer gets their own alert even if this browser
				// session already produced an anonymous one before the email gate.
				sessionId: identity ? `${sessionId}:${identity.email}` : sessionId,
				anonName: identity
					? `${identity.name} (${identity.email})`
					: getAnonymousName(sessionId),
				location,
			}).catch((error) => {
				console.error("Failed to create view notification:", error);
			});
		}
		return Response.json({ success: true });
	}

	if (event === "cta") {
		await db()
			.update(videoViews)
			.set({ ctaClicks: sql`${videoViews.ctaClicks} + 1` })
			.where(viewKey);
		return Response.json({ success: true });
	}

	const duration = finiteNumber(body.duration, 0, MAX_DURATION_SECONDS);
	const position = finiteNumber(body.position, 0, MAX_DURATION_SECONDS) ?? 0;
	const watchedDelta =
		finiteNumber(body.watchedSeconds, 0, MAX_WATCH_DELTA_SECONDS) ?? 0;
	const ranges = sanitizeWatchRanges(body.ranges);

	const [existing] = await db()
		.select({ watchedBuckets: videoViews.watchedBuckets })
		.from(videoViews)
		.where(viewKey)
		.limit(1);

	await db()
		.update(videoViews)
		.set({
			watchedBuckets:
				duration && duration > 0
					? mergeBuckets(
							existing?.watchedBuckets,
							rangesToBuckets(ranges, duration),
						)
					: (existing?.watchedBuckets ?? ""),
			watchedSeconds: sql`${videoViews.watchedSeconds} + ${watchedDelta}`,
			maxPosition: sql`GREATEST(${videoViews.maxPosition}, ${position})`,
			...(duration && duration > 0 ? { videoDuration: duration } : {}),
		})
		.where(viewKey);

	return Response.json({ success: true });
}
