"use server";

import { db } from "@cap/database";
import { getCurrentUser } from "@cap/database/auth/session";
import { videos } from "@cap/database/schema";
import { Storage } from "@cap/web-backend";
import type { Video } from "@cap/web-domain";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { startAiGeneration } from "@/lib/generate-ai";
import { runPromise } from "@/lib/server";
import { decodeStorageVideo } from "@/lib/video-storage";
import { isAiGenerationEnabled } from "@/utils/flags";

const MAX_TRANSCRIPT_BYTES = 2 * 1024 * 1024;

export async function saveDeviceTranscript(
	videoId: Video.VideoId,
	vtt: string,
): Promise<{ success: boolean; message: string }> {
	const user = await getCurrentUser();
	if (!user) return { success: false, message: "Sign in to save a transcript" };

	if (typeof vtt !== "string" || !vtt.startsWith("WEBVTT")) {
		return { success: false, message: "Transcript is not valid WebVTT" };
	}
	if (new TextEncoder().encode(vtt).length > MAX_TRANSCRIPT_BYTES) {
		return { success: false, message: "Transcript is too large" };
	}
	const [video] = await db()
		.select()
		.from(videos)
		.where(eq(videos.id, videoId))
		.limit(1);
	if (!video) return { success: false, message: "Video not found" };
	if (video.ownerId !== user.id) {
		return { success: false, message: "Only the owner can save a transcript" };
	}

	if (!vtt.includes("-->")) {
		await db()
			.update(videos)
			.set({ transcriptionStatus: "NO_AUDIO" })
			.where(eq(videos.id, videoId));
		revalidatePath(`/s/${videoId}`);
		return { success: true, message: "No speech was found in this video" };
	}

	const [bucket] = await Storage.getAccessForVideo(
		decodeStorageVideo(video),
	).pipe(runPromise);
	await bucket
		.putObject(`${video.ownerId}/${videoId}/transcription.vtt`, vtt, {
			contentType: "text/vtt",
		})
		.pipe(runPromise);

	await db()
		.update(videos)
		.set({ transcriptionStatus: "COMPLETE" })
		.where(eq(videos.id, videoId));

	if (await isAiGenerationEnabled(user)) {
		await startAiGeneration(videoId, video.ownerId).catch((error) => {
			console.error("[saveDeviceTranscript] AI generation failed", error);
		});
	}

	revalidatePath(`/s/${videoId}`);
	return { success: true, message: "Transcript saved" };
}
