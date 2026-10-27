import { describe, expect, it } from "vitest";
import {
	bucketCoverage,
	isValidViewerEmail,
	mergeBuckets,
	normalizeBuckets,
	normalizeCtaUrl,
	rangesToBuckets,
	retentionCurve,
	sanitizeWatchRanges,
	summarizeViews,
	type ViewInsightRow,
	WATCH_BUCKETS,
} from "@/lib/video-insights";

const row = (overrides: Partial<ViewInsightRow>): ViewInsightRow => ({
	sessionId: "s1",
	viewerKey: null,
	viewerUserId: null,
	viewerEmail: null,
	watchedBuckets: "",
	watchedSeconds: 0,
	ctaClicks: 0,
	...overrides,
});

describe("watch buckets", () => {
	it("maps watched ranges onto 1% buckets of the video", () => {
		const buckets = rangesToBuckets([[0, 10]], 100);
		expect(buckets).toHaveLength(WATCH_BUCKETS);
		expect(buckets.slice(0, 10)).toBe("1".repeat(10));
		expect(buckets[10]).toBe("0");
		expect(bucketCoverage(buckets)).toBeCloseTo(0.1);
	});

	it("marks the final bucket when playback reaches the end", () => {
		const buckets = rangesToBuckets([[95.5, 100]], 100);
		expect(buckets.slice(95)).toBe("11111");
	});

	it("ignores invalid ranges and clamps to the duration", () => {
		expect(rangesToBuckets([[Number.NaN, 5]], 10)).toBe("0".repeat(100));
		expect(rangesToBuckets([[5, 5]], 10)).toBe("0".repeat(100));
		expect(bucketCoverage(rangesToBuckets([[-5, 50]], 10))).toBe(1);
		expect(rangesToBuckets([[0, 1]], 0)).toBe("0".repeat(100));
	});

	it("merges by union so rewatching never lowers coverage", () => {
		const first = rangesToBuckets([[0, 20]], 100);
		const second = rangesToBuckets([[10, 40]], 100);
		expect(bucketCoverage(mergeBuckets(first, second))).toBeCloseTo(0.4);
		expect(mergeBuckets(first, "")).toBe(first);
	});

	it("normalizes stored values of the wrong length", () => {
		expect(normalizeBuckets("11")).toBe(`11${"0".repeat(98)}`);
		expect(normalizeBuckets(null)).toBe("0".repeat(100));
	});
});

describe("retention", () => {
	it("reports the share of views that reached each part of the video", () => {
		const full = "1".repeat(100);
		const half = rangesToBuckets([[0, 50]], 100);
		const curve = retentionCurve([full, half]);
		expect(curve[0]).toBe(1);
		expect(curve[49]).toBe(1);
		expect(curve[50]).toBe(0.5);
		expect(curve[99]).toBe(0.5);
	});

	it("is flat zero with no views", () => {
		expect(retentionCurve([]).every((v) => v === 0)).toBe(true);
	});
});

describe("summarizeViews", () => {
	it("counts unique viewers by email, then user, then device key", () => {
		const summary = summarizeViews([
			row({ sessionId: "a", viewerEmail: "Pat@Example.com" }),
			row({ sessionId: "b", viewerEmail: "pat@example.com" }),
			row({ sessionId: "c", viewerKey: "device-1" }),
			row({ sessionId: "d", viewerKey: "device-1" }),
			row({ sessionId: "e" }),
		]);
		expect(summary.views).toBe(5);
		expect(summary.uniqueViewers).toBe(3);
	});

	it("computes completion, finished views and CTA click rate", () => {
		const summary = summarizeViews([
			row({
				sessionId: "a",
				watchedBuckets: "1".repeat(100),
				ctaClicks: 2,
				watchedSeconds: 60,
			}),
			row({
				sessionId: "b",
				watchedBuckets: rangesToBuckets([[0, 50]], 100),
				watchedSeconds: 30,
			}),
		]);
		expect(summary.averageCompletion).toBeCloseTo(0.75);
		expect(summary.completedViews).toBe(1);
		expect(summary.ctaClicks).toBe(2);
		expect(summary.ctaClickRate).toBe(0.5);
		expect(summary.totalWatchSeconds).toBe(90);
	});

	it("handles no views", () => {
		expect(summarizeViews([]).views).toBe(0);
	});
});

describe("normalizeCtaUrl", () => {
	it("adds https to bare domains", () => {
		expect(normalizeCtaUrl("calendly.com/rocstarr")).toBe(
			"https://calendly.com/rocstarr",
		);
	});

	it("rejects unsafe or malformed links", () => {
		expect(normalizeCtaUrl("javascript:alert(1)")).toBeNull();
		expect(normalizeCtaUrl("data:text/html,hi")).toBeNull();
		expect(normalizeCtaUrl("localhost")).toBeNull();
		expect(normalizeCtaUrl("  ")).toBeNull();
	});

	it("keeps http and https links", () => {
		expect(normalizeCtaUrl("http://example.com/a?b=1")).toBe(
			"http://example.com/a?b=1",
		);
	});
});

describe("viewer input validation", () => {
	it("accepts normal emails and rejects junk", () => {
		expect(isValidViewerEmail("client@company.co")).toBe(true);
		expect(isValidViewerEmail("not an email")).toBe(false);
		expect(isValidViewerEmail("")).toBe(false);
	});

	it("keeps only well-formed watch ranges", () => {
		expect(
			sanitizeWatchRanges([
				[0, 5],
				[5, 2],
				["a", 3],
				[1],
				[-1, 2],
				[3, Number.POSITIVE_INFINITY],
			]),
		).toEqual([[0, 5]]);
		expect(sanitizeWatchRanges("nope")).toEqual([]);
	});
});
