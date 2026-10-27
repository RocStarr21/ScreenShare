import type { VideoEditRange } from "@cap/database/types";

const CUE_TIMING =
	/(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})/;

const toSeconds = (h: string, m: string, s: string, ms: string) =>
	Number(h) * 3600 +
	Number(m) * 60 +
	Number(s) +
	Number(ms.padEnd(3, "0")) / 1000;

export function parseVttSpeechRanges(vtt: string): VideoEditRange[] {
	const ranges: VideoEditRange[] = [];
	for (const line of vtt.split(/\r?\n/)) {
		const match = CUE_TIMING.exec(line);
		if (!match) continue;
		const [, h1, m1, s1, ms1, h2, m2, s2, ms2] = match;
		if (!h1 || !m1 || !s1 || !ms1 || !h2 || !m2 || !s2 || !ms2) continue;
		const start = toSeconds(h1, m1, s1, ms1);
		const end = toSeconds(h2, m2, s2, ms2);
		if (end > start) ranges.push({ start, end });
	}
	return ranges.sort((a, b) => a.start - b.start);
}

export function findSilentRanges(
	speech: VideoEditRange[],
	duration: number,
	options: { minSilence?: number; keepAround?: number } = {},
): VideoEditRange[] {
	const minSilence = options.minSilence ?? 1;
	const keepAround = options.keepAround ?? 0.25;
	if (!Number.isFinite(duration) || duration <= 0 || speech.length === 0) {
		return [];
	}

	const merged: VideoEditRange[] = [];
	for (const range of [...speech].sort((a, b) => a.start - b.start)) {
		const previous = merged.at(-1);
		if (previous && range.start <= previous.end) {
			previous.end = Math.max(previous.end, range.end);
		} else {
			merged.push({ ...range });
		}
	}

	const silences: VideoEditRange[] = [];
	let cursor = 0;
	for (const range of merged) {
		const gapStart = cursor === 0 ? 0 : cursor + keepAround;
		const gapEnd = range.start - keepAround;
		if (range.start - cursor >= minSilence && gapEnd > gapStart) {
			silences.push({ start: gapStart, end: gapEnd });
		}
		cursor = Math.max(cursor, range.end);
	}
	if (duration - cursor >= minSilence) {
		silences.push({ start: cursor + keepAround, end: duration });
	}

	return silences
		.map((range) => ({
			start: Math.max(0, Math.min(duration, range.start)),
			end: Math.max(0, Math.min(duration, range.end)),
		}))
		.filter((range) => range.end - range.start >= 0.05);
}
