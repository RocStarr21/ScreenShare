"use client";

const TASKS_VISION_BASE =
	"https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1";
const SELFIE_SEGMENTER_MODEL_URL =
	"https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite";
const SEGMENT_MAX_EDGE = 256;
const OUTPUT_MAX_EDGE = 1280;
const BLUR_RADIUS_PX = 16;

type Mask = {
	width: number;
	height: number;
	getAsFloat32Array(): Float32Array;
};

type Segmenter = {
	getLabels(): string[];
	segmentForVideo(
		image: CanvasImageSource,
		timestampMs: number,
		callback: (result: { confidenceMasks?: Mask[] }) => void,
	): void;
	close(): void;
};

type VisionModule = {
	FilesetResolver: { forVisionTasks(basePath: string): Promise<unknown> };
	ImageSegmenter: {
		createFromOptions(fileset: unknown, options: unknown): Promise<Segmenter>;
	};
};

type FrameProcessor = new (init: {
	track: MediaStreamTrack;
}) => { readable: ReadableStream<VideoFrame> };
type FrameGenerator = new (init: {
	kind: "video";
}) => MediaStreamTrack & { writable: WritableStream<VideoFrame> };

let segmenterPromise: Promise<Segmenter> | null = null;

const loadSegmenter = () => {
	segmenterPromise ??= (async () => {
		const vision = (await import(
			/* webpackIgnore: true */ /* turbopackIgnore: true */ `${TASKS_VISION_BASE}/vision_bundle.mjs`
		)) as VisionModule;
		const fileset = await vision.FilesetResolver.forVisionTasks(
			`${TASKS_VISION_BASE}/wasm`,
		);
		let lastError: unknown = null;
		for (const delegate of ["GPU", "CPU"] as const) {
			try {
				return await vision.ImageSegmenter.createFromOptions(fileset, {
					baseOptions: { modelAssetPath: SELFIE_SEGMENTER_MODEL_URL, delegate },
					runningMode: "VIDEO",
					outputConfidenceMasks: true,
					outputCategoryMask: false,
				});
			} catch (error) {
				lastError = error;
			}
		}
		throw lastError instanceof Error
			? lastError
			: new Error("Background blur could not start");
	})();
	segmenterPromise.catch(() => {
		segmenterPromise = null;
	});
	return segmenterPromise;
};

const context2d = (canvas: OffscreenCanvas) => {
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("Canvas is not available");
	return ctx;
};

export type BlurredCamera = {
	stream: MediaStream;
	stop: () => void;
};

export async function createBlurredCamera(
	source: MediaStream,
): Promise<BlurredCamera> {
	const input = source.getVideoTracks()[0];
	if (!input) throw new Error("No camera track to blur");
	const segmenter = await loadSegmenter();

	const labels = (() => {
		try {
			return segmenter.getLabels();
		} catch {
			return [];
		}
	})();
	const namedIndex = labels.findIndex((label) =>
		/person|human|selfie|foreground/i.test(label),
	);

	const small = new OffscreenCanvas(1, 1);
	const smallCtx = context2d(small);
	const mask = new OffscreenCanvas(1, 1);
	const maskCtx = context2d(mask);
	const person = new OffscreenCanvas(1, 1);
	const personCtx = context2d(person);
	const output = new OffscreenCanvas(1, 1);
	const outputCtx = context2d(output);
	let maskPixels: ImageData | null = null;
	let lastTimestamp = 0;

	const render = (frame: CanvasImageSource, width: number, height: number) => {
		const outScale = Math.min(1, OUTPUT_MAX_EDGE / Math.max(width, height));
		const w = Math.max(2, Math.round(width * outScale));
		const h = Math.max(2, Math.round(height * outScale));
		const segScale = Math.min(1, SEGMENT_MAX_EDGE / Math.max(w, h));
		const sw = Math.max(1, Math.round(w * segScale));
		const sh = Math.max(1, Math.round(h * segScale));
		for (const [canvas, cw, ch] of [
			[small, sw, sh],
			[output, w, h],
			[person, w, h],
		] as const) {
			if (canvas.width !== cw) canvas.width = cw;
			if (canvas.height !== ch) canvas.height = ch;
		}

		smallCtx.drawImage(frame, 0, 0, sw, sh);
		lastTimestamp = Math.max(lastTimestamp + 1, Math.floor(performance.now()));
		let hasMask = false;
		segmenter.segmentForVideo(small, lastTimestamp, (result) => {
			const masks = result.confidenceMasks ?? [];
			const index = namedIndex >= 0 ? namedIndex : masks.length > 1 ? 1 : 0;
			const selected = masks[Math.min(index, masks.length - 1)];
			if (!selected) return;
			const values = selected.getAsFloat32Array();
			if (mask.width !== selected.width) mask.width = selected.width;
			if (mask.height !== selected.height) mask.height = selected.height;
			if (
				!maskPixels ||
				maskPixels.width !== selected.width ||
				maskPixels.height !== selected.height
			) {
				maskPixels = maskCtx.createImageData(selected.width, selected.height);
			}
			const data = maskPixels.data;
			for (let i = 0; i < values.length; i++) {
				data[i * 4 + 3] = Math.round(
					Math.min(1, Math.max(0, values[i] ?? 0)) * 255,
				);
			}
			maskCtx.putImageData(maskPixels, 0, 0);
			hasMask = true;
		});

		outputCtx.filter = `blur(${BLUR_RADIUS_PX}px)`;
		outputCtx.drawImage(frame, 0, 0, w, h);
		outputCtx.filter = "none";
		if (hasMask) {
			personCtx.globalCompositeOperation = "copy";
			personCtx.drawImage(frame, 0, 0, w, h);
			personCtx.globalCompositeOperation = "destination-in";
			personCtx.imageSmoothingEnabled = true;
			personCtx.imageSmoothingQuality = "high";
			personCtx.drawImage(mask, 0, 0, w, h);
			outputCtx.drawImage(person, 0, 0);
		}
	};

	const Processor = (
		globalThis as unknown as { MediaStreamTrackProcessor?: FrameProcessor }
	).MediaStreamTrackProcessor;
	const Generator = (
		globalThis as unknown as { MediaStreamTrackGenerator?: FrameGenerator }
	).MediaStreamTrackGenerator;

	let stopped = false;

	if (Processor && Generator && typeof VideoFrame !== "undefined") {
		const reader = new Processor({ track: input }).readable.getReader();
		const generator = new Generator({ kind: "video" });
		const writer = generator.writable.getWriter();
		void (async () => {
			while (!stopped) {
				const { value: frame, done } = await reader.read();
				if (done || !frame) break;
				try {
					render(frame, frame.displayWidth, frame.displayHeight);
					const timestamp = frame.timestamp;
					await writer.write(new VideoFrame(output, { timestamp }));
				} catch (error) {
					console.error("Background blur frame failed", error);
				} finally {
					frame.close();
				}
			}
		})();
		return {
			stream: new MediaStream([generator]),
			stop: () => {
				stopped = true;
				void reader.cancel().catch(() => undefined);
				void writer.close().catch(() => undefined);
				generator.stop();
			},
		};
	}

	const video = document.createElement("video");
	video.muted = true;
	video.playsInline = true;
	video.srcObject = new MediaStream([input]);
	await video.play();
	const visible = document.createElement("canvas");
	const visibleCtx = visible.getContext("2d");
	if (!visibleCtx) throw new Error("Canvas is not available");
	let rafId = 0;
	const tick = () => {
		if (stopped) return;
		if (video.videoWidth > 0) {
			render(video, video.videoWidth, video.videoHeight);
			if (visible.width !== output.width) visible.width = output.width;
			if (visible.height !== output.height) visible.height = output.height;
			visibleCtx.drawImage(output, 0, 0);
		}
		rafId = requestAnimationFrame(tick);
	};
	tick();
	return {
		stream: visible.captureStream(30),
		stop: () => {
			stopped = true;
			cancelAnimationFrame(rafId);
			video.srcObject = null;
		},
	};
}

export const isCameraBlurPreferred = () => {
	try {
		return window.localStorage.getItem("ss-camera-blur") === "true";
	} catch {
		return false;
	}
};
