"use client";

import { useCallback, useEffect, useState } from "react";

export type RecordingQuality = "720p" | "1080p" | "1440p" | "2160p";

export const RECORDING_QUALITY_OPTIONS: Array<{
	value: RecordingQuality;
	label: string;
	width: number;
	height: number;
}> = [
	{ value: "720p", label: "720p (smaller files)", width: 1280, height: 720 },
	{ value: "1080p", label: "1080p HD", width: 1920, height: 1080 },
	{ value: "1440p", label: "1440p", width: 2560, height: 1440 },
	{ value: "2160p", label: "4K", width: 3840, height: 2160 },
];

export const COUNTDOWN_SECONDS = 3;

const STORAGE_KEY = "ss-web-recorder-options";

type RecorderOptions = {
	countdown: boolean;
	noiseFilter: boolean;
	quality: RecordingQuality;
	speakerNotes: string;
};

const DEFAULT_OPTIONS: RecorderOptions = {
	countdown: true,
	noiseFilter: true,
	quality: "1080p",
	speakerNotes: "",
};

const isQuality = (value: unknown): value is RecordingQuality =>
	RECORDING_QUALITY_OPTIONS.some((option) => option.value === value);

export const qualityDimensions = (quality: RecordingQuality) =>
	RECORDING_QUALITY_OPTIONS.find((option) => option.value === quality) ?? {
		value: "1080p" as const,
		label: "1080p HD",
		width: 1920,
		height: 1080,
	};

export const useRecorderOptions = () => {
	const [options, setOptions] = useState<RecorderOptions>(DEFAULT_OPTIONS);

	useEffect(() => {
		try {
			const raw = window.localStorage.getItem(STORAGE_KEY);
			if (!raw) return;
			const parsed = JSON.parse(raw) as Partial<RecorderOptions>;
			setOptions({
				countdown:
					typeof parsed.countdown === "boolean"
						? parsed.countdown
						: DEFAULT_OPTIONS.countdown,
				noiseFilter:
					typeof parsed.noiseFilter === "boolean"
						? parsed.noiseFilter
						: DEFAULT_OPTIONS.noiseFilter,
				quality: isQuality(parsed.quality)
					? parsed.quality
					: DEFAULT_OPTIONS.quality,
				speakerNotes:
					typeof parsed.speakerNotes === "string" ? parsed.speakerNotes : "",
			});
		} catch (error) {
			console.error("Failed to load recorder options", error);
		}
	}, []);

	const update = useCallback(
		<K extends keyof RecorderOptions>(key: K, value: RecorderOptions[K]) => {
			setOptions((previous) => {
				const next = { ...previous, [key]: value };
				try {
					window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
				} catch (error) {
					console.error("Failed to save recorder options", error);
				}
				return next;
			});
		},
		[],
	);

	return { options, update };
};
