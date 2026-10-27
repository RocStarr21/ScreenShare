export const WATCH_BUCKETS = 100;
export const COMPLETED_VIEW_THRESHOLD = 0.9;

export type WatchRange = [number, number];

export type ViewInsightRow = {
	sessionId: string;
	viewerKey: string | null;
	viewerUserId: string | null;
	viewerEmail: string | null;
	watchedBuckets: string;
	watchedSeconds: number;
	ctaClicks: number;
};

export type ViewSummary = {
	views: number;
	uniqueViewers: number;
	averageCompletion: number;
	completedViews: number;
	totalWatchSeconds: number;
	ctaClicks: number;
	ctaClickRate: number;
};

const EMPTY_BUCKETS = "0".repeat(WATCH_BUCKETS);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeBuckets(value: string | null | undefined): string {
	if (!value) return EMPTY_BUCKETS;
	let out = "";
	for (let i = 0; i < WATCH_BUCKETS; i++) out += value[i] === "1" ? "1" : "0";
	return out;
}

export function rangesToBuckets(
	ranges: WatchRange[],
	duration: number,
): string {
	if (!Number.isFinite(duration) || duration <= 0) return EMPTY_BUCKETS;
	const marks = new Array<boolean>(WATCH_BUCKETS).fill(false);
	for (const [rawStart, rawEnd] of ranges) {
		if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) continue;
		const start = Math.max(0, Math.min(rawStart, rawEnd));
		const end = Math.min(duration, Math.max(rawStart, rawEnd));
		if (end <= start) continue;
		const first = Math.floor((start / duration) * WATCH_BUCKETS);
		const last = Math.min(
			WATCH_BUCKETS - 1,
			Math.ceil((end / duration) * WATCH_BUCKETS) - 1,
		);
		for (let i = Math.max(0, first); i <= last; i++) marks[i] = true;
	}
	return marks.map((m) => (m ? "1" : "0")).join("");
}

export function mergeBuckets(
	a: string | null | undefined,
	b: string | null | undefined,
): string {
	const left = normalizeBuckets(a);
	const right = normalizeBuckets(b);
	let out = "";
	for (let i = 0; i < WATCH_BUCKETS; i++) {
		out += left[i] === "1" || right[i] === "1" ? "1" : "0";
	}
	return out;
}

export function bucketCoverage(buckets: string | null | undefined): number {
	const normalized = normalizeBuckets(buckets);
	let watched = 0;
	for (const c of normalized) if (c === "1") watched++;
	return watched / WATCH_BUCKETS;
}

export function retentionCurve(
	rows: Array<string | null | undefined>,
): number[] {
	const curve = new Array<number>(WATCH_BUCKETS).fill(0);
	if (rows.length === 0) return curve;
	for (const row of rows) {
		const normalized = normalizeBuckets(row);
		for (let i = 0; i < WATCH_BUCKETS; i++) {
			if (normalized[i] === "1") curve[i] = (curve[i] ?? 0) + 1;
		}
	}
	return curve.map((count) => count / rows.length);
}

export function viewerIdentity(
	row: Pick<
		ViewInsightRow,
		"viewerEmail" | "viewerUserId" | "viewerKey" | "sessionId"
	>,
): string {
	if (row.viewerEmail) return `email:${row.viewerEmail.toLowerCase()}`;
	if (row.viewerUserId) return `user:${row.viewerUserId}`;
	if (row.viewerKey) return `key:${row.viewerKey}`;
	return `session:${row.sessionId}`;
}

export function summarizeViews(rows: ViewInsightRow[]): ViewSummary {
	const views = rows.length;
	if (views === 0) {
		return {
			views: 0,
			uniqueViewers: 0,
			averageCompletion: 0,
			completedViews: 0,
			totalWatchSeconds: 0,
			ctaClicks: 0,
			ctaClickRate: 0,
		};
	}
	const identities = new Set(rows.map(viewerIdentity));
	let completionSum = 0;
	let completedViews = 0;
	let totalWatchSeconds = 0;
	let ctaClicks = 0;
	let viewsWithCtaClick = 0;
	for (const row of rows) {
		const coverage = bucketCoverage(row.watchedBuckets);
		completionSum += coverage;
		if (coverage >= COMPLETED_VIEW_THRESHOLD) completedViews++;
		totalWatchSeconds += Math.max(0, row.watchedSeconds);
		ctaClicks += Math.max(0, row.ctaClicks);
		if (row.ctaClicks > 0) viewsWithCtaClick++;
	}
	return {
		views,
		uniqueViewers: identities.size,
		averageCompletion: completionSum / views,
		completedViews,
		totalWatchSeconds,
		ctaClicks,
		ctaClickRate: viewsWithCtaClick / views,
	};
}

export function normalizeCtaUrl(
	input: string | null | undefined,
): string | null {
	const trimmed = input?.trim();
	if (!trimmed) return null;
	const withProtocol = /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
		? trimmed
		: `https://${trimmed}`;
	try {
		const url = new URL(withProtocol);
		if (url.protocol !== "https:" && url.protocol !== "http:") return null;
		if (!url.hostname.includes(".")) return null;
		return url.toString();
	} catch {
		return null;
	}
}

export function isValidViewerEmail(email: string | null | undefined): boolean {
	const trimmed = email?.trim() ?? "";
	return trimmed.length <= 255 && EMAIL_PATTERN.test(trimmed);
}

export function sanitizeWatchRanges(
	input: unknown,
	maxRanges = 200,
): WatchRange[] {
	if (!Array.isArray(input)) return [];
	const ranges: WatchRange[] = [];
	for (const item of input.slice(0, maxRanges)) {
		if (!Array.isArray(item) || item.length !== 2) continue;
		const [start, end] = item as [unknown, unknown];
		if (typeof start !== "number" || typeof end !== "number") continue;
		if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
		if (end <= start || start < 0) continue;
		ranges.push([start, end]);
	}
	return ranges;
}
