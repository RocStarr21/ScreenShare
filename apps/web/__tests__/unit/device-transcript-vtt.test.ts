import { describe, expect, it } from "vitest";
import {
	type TimedTranscriptWord,
	wordsToWebVTT,
} from "@/lib/transcribe-utils";

const words = (spec: Array<[string, number, number]>): TimedTranscriptWord[] =>
	spec.map(([text, start, end]) => ({ text, start, end }));

const cues = (vtt: string) =>
	vtt
		.split("\n\n")
		.slice(1)
		.filter(Boolean)
		.map((block) => block.split("\n"));

describe("wordsToWebVTT", () => {
	it("starts with a WebVTT header and numbers cues from 1", () => {
		const vtt = wordsToWebVTT(
			words([
				["Hello", 0, 0.4],
				["there.", 0.4, 0.9],
			]),
		);
		expect(vtt.startsWith("WEBVTT\n\n")).toBe(true);
		expect(cues(vtt)).toEqual([
			["1", "00:00:00.000 --> 00:00:00.900", "Hello there."],
		]);
	});

	it("breaks cues at punctuation, long pauses and every eight words", () => {
		const vtt = wordsToWebVTT(
			words([
				["one,", 0, 0.2],
				["two", 0.3, 0.5],
				["three", 1.5, 1.7],
				["a", 2, 2.1],
				["b", 2.1, 2.2],
				["c", 2.2, 2.3],
				["d", 2.3, 2.4],
				["e", 2.4, 2.5],
				["f", 2.5, 2.6],
				["g", 2.6, 2.7],
				["h", 2.7, 2.8],
				["i", 2.8, 2.9],
			]),
		);
		expect(cues(vtt).map((cue) => cue[2])).toEqual([
			"one,",
			"two",
			"three a b c d e f g",
			"h i",
		]);
	});

	it("skips blank words and returns only the header with no speech", () => {
		expect(wordsToWebVTT([])).toBe("WEBVTT\n\n");
		const vtt = wordsToWebVTT(
			words([
				[" ", 0, 0.1],
				[" ok ", 0.2, 0.5],
			]),
		);
		expect(cues(vtt)).toEqual([["1", "00:00:00.200 --> 00:00:00.500", "ok"]]);
	});

	it("never ends a cue before it starts", () => {
		const vtt = wordsToWebVTT(words([["glitch", 5, 4]]));
		expect(cues(vtt)[0]?.[1]).toBe("00:00:05.000 --> 00:00:05.000");
	});
});
