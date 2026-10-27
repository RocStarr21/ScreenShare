"use client";

import type { TimedTranscriptWord } from "@/lib/transcribe-utils";

export type DeviceTranscriptionModel = "tiny" | "base" | "small";

export type DeviceTranscriptionProgress = {
	stage: "audio" | "download" | "load" | "transcribe";
	progress: number;
	message: string;
};

type WorkerMessage =
	| ({ type: "progress"; id: number } & DeviceTranscriptionProgress)
	| {
			type: "result";
			id: number;
			words: TimedTranscriptWord[];
			language: string;
	  }
	| { type: "error"; id: number; message: string };

const SAMPLE_RATE = 16000;

export class NoAudioError extends Error {
	constructor() {
		super("This video has no audio to transcribe");
	}
}

async function loadMonoAudio(
	videoId: string,
	onProgress: (progress: DeviceTranscriptionProgress) => void,
) {
	onProgress({
		stage: "audio",
		progress: 0,
		message: "Getting the video's audio…",
	});
	const response = await fetch(
		`/s/${encodeURIComponent(videoId)}/transcription-audio`,
	);
	if (response.status === 422) throw new NoAudioError();
	if (!response.ok) {
		const body = (await response.json().catch(() => null)) as {
			error?: string;
		} | null;
		throw new Error(body?.error ?? "Could not get the video's audio");
	}
	const bytes = await response.arrayBuffer();
	onProgress({ stage: "audio", progress: 1, message: "Decoding audio…" });
	const decoded = await new OfflineAudioContext(
		1,
		SAMPLE_RATE,
		SAMPLE_RATE,
	).decodeAudioData(bytes);
	const mono = new Float32Array(decoded.length);
	for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
		const data = decoded.getChannelData(channel);
		for (let i = 0; i < mono.length; i++) {
			mono[i] = (mono[i] ?? 0) + (data[i] ?? 0) / decoded.numberOfChannels;
		}
	}
	return mono;
}

export async function transcribeOnDevice(
	videoId: string,
	options: {
		model: DeviceTranscriptionModel;
		language: string;
		onProgress: (progress: DeviceTranscriptionProgress) => void;
	},
): Promise<{ words: TimedTranscriptWord[]; language: string }> {
	const audio = await loadMonoAudio(videoId, options.onProgress);
	const worker = new Worker("/workers/device-transcribe.js", {
		type: "module",
	});
	try {
		return await new Promise((resolve, reject) => {
			worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
				const message = event.data;
				if (message.type === "progress") options.onProgress(message);
				else if (message.type === "result") resolve(message);
				else reject(new Error(message.message));
			};
			worker.onerror = (event) =>
				reject(
					new Error(
						event.message ||
							"The speech model could not start. Check your internet connection and try again.",
					),
				);
			worker.postMessage(
				{
					type: "transcribe",
					id: 1,
					audio,
					model: options.model,
					language: options.language,
				},
				[audio.buffer],
			);
		});
	} finally {
		worker.terminate();
	}
}
