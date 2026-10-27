"use client";

import { Button } from "@cap/ui";
import type { Video } from "@cap/web-domain";
import { MessageSquare } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { saveDeviceTranscript } from "@/actions/videos/device-transcript";
import { wordsToWebVTT } from "@/lib/transcribe-utils";
import {
	type DeviceTranscriptionModel,
	type DeviceTranscriptionProgress,
	NoAudioError,
	transcribeOnDevice,
} from "./device-transcription";

const MODELS: Array<{ value: DeviceTranscriptionModel; label: string }> = [
	{ value: "tiny", label: "Fast (40–120 MB download)" },
	{ value: "base", label: "Balanced (80–250 MB)" },
	{ value: "small", label: "Most accurate (250–600 MB)" },
];

const LANGUAGES: Array<{ value: string; label: string }> = [
	{ value: "auto", label: "Detect automatically" },
	{ value: "en", label: "English" },
	{ value: "es", label: "Spanish" },
	{ value: "fr", label: "French" },
	{ value: "de", label: "German" },
	{ value: "pt", label: "Portuguese" },
	{ value: "it", label: "Italian" },
	{ value: "nl", label: "Dutch" },
	{ value: "hi", label: "Hindi" },
	{ value: "ar", label: "Arabic" },
	{ value: "zh", label: "Chinese" },
	{ value: "ja", label: "Japanese" },
];

export function DeviceTranscriptPanel({
	videoId,
	canTranscribe,
	onComplete,
}: {
	videoId: Video.VideoId;
	canTranscribe: boolean;
	onComplete: () => void;
}) {
	const modelId = useId();
	const languageId = useId();
	const [model, setModel] = useState<DeviceTranscriptionModel>("base");
	const [language, setLanguage] = useState("auto");
	const [progress, setProgress] = useState<DeviceTranscriptionProgress | null>(
		null,
	);
	const running = progress !== null;

	if (!canTranscribe) {
		return (
			<div className="flex justify-center items-center p-6 h-full text-center">
				<div>
					<MessageSquare className="mx-auto mb-2 w-8 h-8 text-gray-300" />
					<p className="text-sm font-medium text-gray-12">No transcript yet</p>
				</div>
			</div>
		);
	}

	const run = async () => {
		setProgress({ stage: "audio", progress: 0, message: "Starting…" });
		try {
			const result = await transcribeOnDevice(videoId, {
				model,
				language,
				onProgress: setProgress,
			});
			setProgress({
				stage: "transcribe",
				progress: 1,
				message: "Saving transcript…",
			});
			const saved = await saveDeviceTranscript(
				videoId,
				wordsToWebVTT(result.words),
			);
			if (!saved.success) throw new Error(saved.message);
			toast.success(saved.message);
			onComplete();
		} catch (error) {
			if (error instanceof NoAudioError) {
				await saveDeviceTranscript(videoId, "WEBVTT\n\n").catch(() => null);
				toast.message(error.message);
				onComplete();
			} else {
				toast.error(
					error instanceof Error ? error.message : "Transcription failed",
				);
			}
		} finally {
			setProgress(null);
		}
	};

	return (
		<div className="flex flex-col gap-4 p-4">
			<div className="flex flex-col gap-1">
				<h3 className="text-sm font-semibold text-gray-12">
					Create a transcript
				</h3>
				<p className="text-xs text-gray-10">
					Runs on this computer, so it is free and private. The speech model
					downloads once and is then cached. Captions and the transcript appear
					for everyone who watches.
				</p>
			</div>

			<label htmlFor={modelId} className="flex flex-col gap-1">
				<span className="text-xs font-medium text-gray-11">Quality</span>
				<select
					id={modelId}
					value={model}
					disabled={running}
					onChange={(event) =>
						setModel(event.target.value as DeviceTranscriptionModel)
					}
					className="px-2 h-9 text-sm rounded-lg border border-gray-4 bg-gray-1 text-gray-12"
				>
					{MODELS.map((option) => (
						<option key={option.value} value={option.value}>
							{option.label}
						</option>
					))}
				</select>
			</label>

			<label htmlFor={languageId} className="flex flex-col gap-1">
				<span className="text-xs font-medium text-gray-11">
					Spoken language
				</span>
				<select
					id={languageId}
					value={language}
					disabled={running}
					onChange={(event) => setLanguage(event.target.value)}
					className="px-2 h-9 text-sm rounded-lg border border-gray-4 bg-gray-1 text-gray-12"
				>
					{LANGUAGES.map((option) => (
						<option key={option.value} value={option.value}>
							{option.label}
						</option>
					))}
				</select>
			</label>

			{running ? (
				<div className="flex flex-col gap-2">
					<div className="h-1.5 rounded-full bg-gray-4">
						<div
							className="h-1.5 rounded-full bg-blue-500 transition-[width] duration-300"
							style={{
								width: `${Math.round(Math.min(1, progress.progress) * 100)}%`,
							}}
						/>
					</div>
					<p className="text-xs text-gray-10" aria-live="polite">
						{progress.message}
					</p>
					<p className="text-[11px] text-gray-9">
						Keep this tab open until it finishes.
					</p>
				</div>
			) : (
				<Button type="button" variant="dark" size="sm" onClick={run}>
					Generate transcript
				</Button>
			)}
		</div>
	);
}
