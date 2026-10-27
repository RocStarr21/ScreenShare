"use client";

import { openShareUrlInNewTab } from "@cap/recorder-core/recorder-utils";
import { Organisation } from "@cap/web-domain";
import { createVideoAndGetUploadUrl } from "@/actions/video/upload";
import { uploadWithTarget } from "@/utils/upload-target";

const JPEG_QUALITY = 0.92;

const nextFrame = (video: HTMLVideoElement) =>
	new Promise<void>((resolve) => {
		const withCallback = video as HTMLVideoElement & {
			requestVideoFrameCallback?: (callback: () => void) => number;
		};
		if (typeof withCallback.requestVideoFrameCallback === "function") {
			withCallback.requestVideoFrameCallback(() => resolve());
		} else {
			setTimeout(resolve, 150);
		}
	});

async function captureScreenFrame(): Promise<Blob> {
	const stream = await navigator.mediaDevices.getDisplayMedia({
		video: { frameRate: { ideal: 5 } },
		audio: false,
	});
	try {
		const video = document.createElement("video");
		video.muted = true;
		video.playsInline = true;
		video.srcObject = stream;
		await video.play();
		await nextFrame(video);
		const canvas = document.createElement("canvas");
		canvas.width = video.videoWidth;
		canvas.height = video.videoHeight;
		const context = canvas.getContext("2d");
		if (!context || !canvas.width || !canvas.height) {
			throw new Error("Could not read the shared screen");
		}
		context.drawImage(video, 0, 0);
		video.srcObject = null;
		return await new Promise<Blob>((resolve, reject) => {
			canvas.toBlob(
				(blob) =>
					blob ? resolve(blob) : reject(new Error("Could not save screenshot")),
				"image/jpeg",
				JPEG_QUALITY,
			);
		});
	} finally {
		for (const track of stream.getTracks()) track.stop();
	}
}

export async function takeAndShareScreenshot(orgId: string) {
	const image = await captureScreenFrame();
	const created = await createVideoAndGetUploadUrl({
		isScreenshot: true,
		orgId: Organisation.OrganisationId.make(orgId),
	});
	await uploadWithTarget({
		target: created.uploadTarget,
		body: image,
		fileName: "screen-capture.jpg",
	});
	const shareUrl = `${window.location.origin}/s/${created.id}`;
	let copied = false;
	try {
		await navigator.clipboard.writeText(shareUrl);
		copied = true;
	} catch {
		copied = false;
	}
	openShareUrlInNewTab(shareUrl);
	return { shareUrl, copied };
}
