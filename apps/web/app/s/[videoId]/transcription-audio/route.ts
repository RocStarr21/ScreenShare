import { promises as fs } from "node:fs";
import { db } from "@cap/database";
import { getCurrentUser } from "@cap/database/auth/session";
import { videos, videoUploads } from "@cap/database/schema";
import { Storage } from "@cap/web-backend";
import { Video } from "@cap/web-domain";
import { eq } from "drizzle-orm";
import { checkHasAudioTrack, extractAudioFromUrl } from "@/lib/audio-extract";
import {
	checkHasAudioTrackViaMediaServer,
	extractAudioViaMediaServer,
	isMediaServerConfigured,
} from "@/lib/media-client";
import { runPromise } from "@/lib/server";
import { decodeStorageVideo } from "@/lib/video-storage";

export const maxDuration = 300;

export async function GET(
	_request: Request,
	props: RouteContext<"/s/[videoId]/transcription-audio">,
) {
	const user = await getCurrentUser();
	if (!user) return Response.json({ error: "Sign in" }, { status: 401 });

	const { videoId: rawVideoId } = await props.params;
	const videoId = Video.VideoId.make(rawVideoId);
	const [video] = await db()
		.select()
		.from(videos)
		.where(eq(videos.id, videoId))
		.limit(1);
	if (!video) return Response.json({ error: "Not found" }, { status: 404 });
	if (video.ownerId !== user.id) {
		return Response.json(
			{ error: "Only the owner can transcribe" },
			{ status: 403 },
		);
	}

	const [bucket] = await Storage.getAccessForVideo(
		decodeStorageVideo(video),
	).pipe(runPromise);
	const [upload] = await db()
		.select({ rawFileKey: videoUploads.rawFileKey })
		.from(videoUploads)
		.where(eq(videoUploads.videoId, videoId))
		.limit(1);

	let sourceUrl: string | null = null;
	for (const key of [
		`${video.ownerId}/${videoId}/result.mp4`,
		upload?.rawFileKey,
	]) {
		if (!key) continue;
		const exists = await bucket
			.headObject(key)
			.pipe(runPromise)
			.then(() => true)
			.catch(() => false);
		if (exists) {
			sourceUrl = await bucket.getInternalSignedObjectUrl(key).pipe(runPromise);
			break;
		}
	}
	if (!sourceUrl) {
		return Response.json({ error: "Video file not found" }, { status: 404 });
	}

	try {
		let audio: Uint8Array;
		if (isMediaServerConfigured()) {
			if (!(await checkHasAudioTrackViaMediaServer(sourceUrl))) {
				return Response.json({ code: "NO_AUDIO" }, { status: 422 });
			}
			audio = new Uint8Array(await extractAudioViaMediaServer(sourceUrl));
		} else {
			if (!(await checkHasAudioTrack(sourceUrl))) {
				return Response.json({ code: "NO_AUDIO" }, { status: 422 });
			}
			const extracted = await extractAudioFromUrl(sourceUrl);
			try {
				audio = new Uint8Array(await fs.readFile(extracted.filePath));
			} finally {
				await extracted.cleanup();
			}
		}
		return new Response(audio, {
			headers: {
				"Content-Type": "audio/mpeg",
				"Cache-Control": "private, no-store",
			},
		});
	} catch (error) {
		if (error instanceof Error && error.message === "NO_AUDIO_TRACK") {
			return Response.json({ code: "NO_AUDIO" }, { status: 422 });
		}
		console.error("[transcription-audio] extraction failed", error);
		return Response.json(
			{ error: "Could not extract audio from this video" },
			{ status: 500 },
		);
	}
}
