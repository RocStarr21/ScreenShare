import { describe, expect, it } from "vitest";
import { findSilentRanges, parseVttSpeechRanges } from "@/lib/silence-ranges";

const VTT = `WEBVTT

1
00:00:03.000 --> 00:00:05.500
Hello there.

2
00:00:05.700 --> 00:00:08.000
Second line

3
00:00:12.000 --> 00:00:14.250
After a pause
`;

describe("parseVttSpeechRanges", () => {
	it("reads cue timings in order", () => {
		expect(parseVttSpeechRanges(VTT)).toEqual([
			{ start: 3, end: 5.5 },
			{ start: 5.7, end: 8 },
			{ start: 12, end: 14.25 },
		]);
	});

	it("accepts comma milliseconds and ignores malformed lines", () => {
		expect(
			parseVttSpeechRanges(
				"1\n00:00:01,500 --> 00:00:02,000\nhi\n00:00:05.000 --> 00:00:04.000\n",
			),
		).toEqual([{ start: 1.5, end: 2 }]);
	});
});

describe("findSilentRanges", () => {
	it("cuts leading, middle and trailing silences but keeps a little air", () => {
		const silences = findSilentRanges(parseVttSpeechRanges(VTT), 20);
		expect(silences).toEqual([
			{ start: 0, end: 2.75 },
			{ start: 8.25, end: 11.75 },
			{ start: 14.5, end: 20 },
		]);
	});

	it("leaves short pauses alone", () => {
		expect(
			findSilentRanges(
				[
					{ start: 0.2, end: 2 },
					{ start: 2.6, end: 4 },
				],
				4.3,
			),
		).toEqual([]);
	});

	it("respects a custom minimum silence", () => {
		const speech = [
			{ start: 0, end: 2 },
			{ start: 3.5, end: 5 },
		];
		expect(findSilentRanges(speech, 5, { minSilence: 2 })).toEqual([]);
		expect(findSilentRanges(speech, 5, { minSilence: 1 })).toEqual([
			{ start: 2.25, end: 3.25 },
		]);
	});

	it("does nothing without speech or duration", () => {
		expect(findSilentRanges([], 10)).toEqual([]);
		expect(findSilentRanges([{ start: 0, end: 1 }], 0)).toEqual([]);
	});
});
