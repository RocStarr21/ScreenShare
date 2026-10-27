import "server-only";

import { db } from "@cap/database";
import { videoShareOptions } from "@cap/database/schema";
import type { Video } from "@cap/web-domain";
import { eq } from "drizzle-orm";

export type VideoShareOptions = {
	ctaText: string | null;
	ctaUrl: string | null;
	emailGate: boolean;
	allowDownload: boolean;
	customThumbnail: boolean;
};

export const DEFAULT_VIDEO_SHARE_OPTIONS: VideoShareOptions = {
	ctaText: null,
	ctaUrl: null,
	emailGate: false,
	allowDownload: false,
	customThumbnail: false,
};

export const CUSTOM_THUMBNAIL_MARKER = "custom";

export async function getVideoShareOptions(
	videoId: Video.VideoId,
): Promise<VideoShareOptions> {
	const [row] = await db()
		.select()
		.from(videoShareOptions)
		.where(eq(videoShareOptions.videoId, videoId))
		.limit(1);
	if (!row) return DEFAULT_VIDEO_SHARE_OPTIONS;
	return {
		ctaText: row.ctaText,
		ctaUrl: row.ctaUrl,
		emailGate: row.emailGate,
		allowDownload: row.allowDownload,
		customThumbnail: row.thumbnailKey === CUSTOM_THUMBNAIL_MARKER,
	};
}
