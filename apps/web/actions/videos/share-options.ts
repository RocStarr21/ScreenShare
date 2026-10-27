"use server";

import { db } from "@cap/database";
import { getCurrentUser } from "@cap/database/auth/session";
import {
	organizationMembers,
	videoShareOptions,
	videos,
	videoViews,
} from "@cap/database/schema";
import { provideOptionalAuth, Storage, VideosPolicy } from "@cap/web-backend";
import { Policy, type Video } from "@cap/web-domain";
import { and, desc, eq } from "drizzle-orm";
import { Effect, Exit } from "effect";
import { revalidatePath } from "next/cache";
import { getAnonymousName } from "@/lib/anonymous-names";
import * as EffectRuntime from "@/lib/server";
import { runPromise } from "@/lib/server";
import {
	bucketCoverage,
	isValidViewerEmail,
	normalizeCtaUrl,
	retentionCurve,
	summarizeViews,
	type ViewSummary,
} from "@/lib/video-insights";
import {
	CUSTOM_THUMBNAIL_MARKER,
	getVideoShareOptions,
	type VideoShareOptions,
} from "@/lib/video-share-options";
import { decodeStorageVideo } from "@/lib/video-storage";
import { setViewerIdentity } from "@/lib/viewer-identity-cookie";

const MAX_LISTED_VIEWS = 200;
const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;

export type VideoViewerRow = {
	id: string;
	label: string;
	email: string | null;
	identified: boolean;
	location: string | null;
	device: string | null;
	watchedPercent: number;
	watchedSeconds: number;
	ctaClicks: number;
	lastSeenAt: string;
};

export type VideoInsights = {
	summary: ViewSummary;
	retention: number[];
	viewers: VideoViewerRow[];
};

async function loadVideo(videoId: Video.VideoId) {
	const [video] = await db()
		.select()
		.from(videos)
		.where(eq(videos.id, videoId))
		.limit(1);
	if (!video) throw new Error("Video not found");
	return video;
}

async function requireOwner(videoId: Video.VideoId) {
	const user = await getCurrentUser();
	if (!user) throw new Error("Sign in to manage this video");
	const video = await loadVideo(videoId);
	if (video.ownerId !== user.id) {
		throw new Error("Only the video owner can change this");
	}
	return { user, video };
}

async function requireOwnerOrMember(videoId: Video.VideoId) {
	const user = await getCurrentUser();
	if (!user) throw new Error("Sign in to view insights");
	const video = await loadVideo(videoId);
	if (video.ownerId === user.id) return video;
	const [membership] = await db()
		.select({ id: organizationMembers.id })
		.from(organizationMembers)
		.where(
			and(
				eq(organizationMembers.userId, user.id),
				eq(organizationMembers.organizationId, video.orgId),
			),
		)
		.limit(1);
	if (!membership) throw new Error("You don't have access to these insights");
	return video;
}

export async function getVideoInsights(
	videoId: Video.VideoId,
): Promise<VideoInsights> {
	await requireOwnerOrMember(videoId);
	const rows = await db()
		.select()
		.from(videoViews)
		.where(eq(videoViews.videoId, videoId))
		.orderBy(desc(videoViews.updatedAt));

	return {
		summary: summarizeViews(rows),
		retention: retentionCurve(rows.map((row) => row.watchedBuckets)),
		viewers: rows.slice(0, MAX_LISTED_VIEWS).map((row) => ({
			id: row.id,
			label:
				row.viewerName ?? row.viewerEmail ?? getAnonymousName(row.sessionId),
			email: row.viewerEmail,
			identified: Boolean(row.viewerEmail || row.viewerUserId),
			location:
				row.city && row.country
					? `${row.city}, ${row.country}`
					: (row.city ?? row.country),
			device: [row.browser, row.os].filter(Boolean).join(" · ") || null,
			watchedPercent: Math.round(bucketCoverage(row.watchedBuckets) * 100),
			watchedSeconds: Math.round(row.watchedSeconds),
			ctaClicks: row.ctaClicks,
			lastSeenAt: row.updatedAt.toISOString(),
		})),
	};
}

export async function getOwnerShareOptions(
	videoId: Video.VideoId,
): Promise<VideoShareOptions> {
	await requireOwnerOrMember(videoId);
	return getVideoShareOptions(videoId);
}

export async function updateVideoShareOptions(
	videoId: Video.VideoId,
	input: {
		ctaText?: string | null;
		ctaUrl?: string | null;
		emailGate?: boolean;
		allowDownload?: boolean;
	},
): Promise<VideoShareOptions> {
	await requireOwner(videoId);

	const ctaText = input.ctaText?.trim().slice(0, 80) || null;
	const ctaUrl = input.ctaUrl?.trim() ? normalizeCtaUrl(input.ctaUrl) : null;
	if (input.ctaUrl?.trim() && !ctaUrl) {
		throw new Error("Enter a valid web address for the button");
	}
	if (ctaText && !ctaUrl) {
		throw new Error("Add a link for the button");
	}

	const values = {
		ctaText: ctaUrl ? (ctaText ?? "Learn more") : null,
		ctaUrl,
		emailGate: Boolean(input.emailGate),
		allowDownload: Boolean(input.allowDownload),
	};

	await db()
		.insert(videoShareOptions)
		.values({ videoId, ...values })
		.onDuplicateKeyUpdate({ set: values });

	revalidatePath(`/s/${videoId}`);
	return getVideoShareOptions(videoId);
}

const isJpeg = (bytes: Uint8Array) =>
	bytes.length > 3 &&
	bytes[0] === 0xff &&
	bytes[1] === 0xd8 &&
	bytes[2] === 0xff;

export async function setVideoThumbnail(
	videoId: Video.VideoId,
	formData: FormData,
) {
	const { video } = await requireOwner(videoId);
	const file = formData.get("thumbnail");
	if (!(file instanceof Blob)) throw new Error("Choose an image");
	if (file.size > MAX_THUMBNAIL_BYTES) {
		throw new Error("Thumbnail must be under 2 MB");
	}
	const bytes = new Uint8Array(await file.arrayBuffer());
	if (!isJpeg(bytes)) throw new Error("Thumbnail must be a JPEG image");

	const base = `${video.ownerId}/${videoId}/screenshot`;
	const currentKey = `${base}/screen-capture.jpg`;
	const originalKey = `${base}/screen-capture-original.jpg`;

	await Effect.gen(function* () {
		const [bucket] = yield* Storage.getAccessForVideo(
			decodeStorageVideo(video),
		);
		const exists = (key: string) =>
			bucket.headObject(key).pipe(
				Effect.as(true),
				Effect.catchAll(() => Effect.succeed(false)),
			);
		if (!(yield* exists(originalKey)) && (yield* exists(currentKey))) {
			const url = yield* bucket.getInternalSignedObjectUrl(currentKey);
			const original = yield* Effect.tryPromise(async () => {
				const response = await fetch(url);
				if (!response.ok) throw new Error("Could not back up thumbnail");
				return new Uint8Array(await response.arrayBuffer());
			});
			yield* bucket.putObject(originalKey, original, {
				contentType: "image/jpeg",
				contentLength: original.length,
			});
		}
		yield* bucket.putObject(currentKey, bytes, {
			contentType: "image/jpeg",
			contentLength: bytes.length,
		});
	}).pipe(runPromise);

	await db()
		.insert(videoShareOptions)
		.values({ videoId, thumbnailKey: CUSTOM_THUMBNAIL_MARKER })
		.onDuplicateKeyUpdate({ set: { thumbnailKey: CUSTOM_THUMBNAIL_MARKER } });

	revalidatePath(`/s/${videoId}`);
	return { success: true as const };
}

export async function resetVideoThumbnail(videoId: Video.VideoId) {
	const { video } = await requireOwner(videoId);
	const base = `${video.ownerId}/${videoId}/screenshot`;
	const currentKey = `${base}/screen-capture.jpg`;
	const originalKey = `${base}/screen-capture-original.jpg`;

	await Effect.gen(function* () {
		const [bucket] = yield* Storage.getAccessForVideo(
			decodeStorageVideo(video),
		);
		const hasOriginal = yield* bucket.headObject(originalKey).pipe(
			Effect.as(true),
			Effect.catchAll(() => Effect.succeed(false)),
		);
		if (!hasOriginal) return;
		const url = yield* bucket.getInternalSignedObjectUrl(originalKey);
		const original = yield* Effect.tryPromise(async () => {
			const response = await fetch(url);
			if (!response.ok) throw new Error("Could not restore thumbnail");
			return new Uint8Array(await response.arrayBuffer());
		});
		yield* bucket.putObject(currentKey, original, {
			contentType: "image/jpeg",
			contentLength: original.length,
		});
		yield* bucket.deleteObject(originalKey);
	}).pipe(runPromise);

	await db()
		.update(videoShareOptions)
		.set({ thumbnailKey: null })
		.where(eq(videoShareOptions.videoId, videoId));

	revalidatePath(`/s/${videoId}`);
	return { success: true as const };
}

export async function submitViewerDetails(
	videoId: Video.VideoId,
	input: { name: string; email: string },
) {
	const name = input.name?.trim() ?? "";
	const email = input.email?.trim() ?? "";
	if (!name) return { success: false as const, message: "Enter your name" };
	if (!isValidViewerEmail(email)) {
		return { success: false as const, message: "Enter a valid email address" };
	}

	const exit = await Effect.gen(function* () {
		const videosPolicy = yield* VideosPolicy;
		return yield* Effect.promise(() =>
			db().select({ id: videos.id }).from(videos).where(eq(videos.id, videoId)),
		).pipe(Policy.withPublicPolicy(videosPolicy.canView(videoId)));
	}).pipe(provideOptionalAuth, EffectRuntime.runPromiseExit);

	if (Exit.isFailure(exit) || exit.value.length === 0) {
		return { success: false as const, message: "Video not found" };
	}

	await setViewerIdentity({ name, email });
	revalidatePath(`/s/${videoId}`);
	return { success: true as const };
}
