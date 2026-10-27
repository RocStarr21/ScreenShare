"use client";

import type { RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

const SESSION_STORAGE_KEY = "cap_tb_session_id";
const SESSION_TTL_MS = 30 * 60 * 1000;
const VIEWER_KEY_STORAGE_KEY = "ss_viewer_key";
const FLUSH_INTERVAL_MS = 10_000;
const ELEMENT_POLL_MS = 500;
const MAX_CONTINUOUS_STEP_SECONDS = 1.5;

type WatchRange = [number, number];

const randomId = () =>
	typeof crypto !== "undefined" && "randomUUID" in crypto
		? crypto.randomUUID()
		: Math.random().toString(36).slice(2) + Date.now().toString(36);

export const ensureAnalyticsSessionId = () => {
	if (typeof window === "undefined") return "anonymous";
	try {
		const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
		const now = Date.now();
		if (raw) {
			const parsed = JSON.parse(raw) as { value: string; expiry: number };
			if (parsed?.value && parsed.expiry > now) return parsed.value;
		}
		const newId = randomId();
		window.localStorage.setItem(
			SESSION_STORAGE_KEY,
			JSON.stringify({ value: newId, expiry: now + SESSION_TTL_MS }),
		);
		return newId;
	} catch (error) {
		console.warn("Failed to persist analytics session id", error);
		return "anonymous";
	}
};

const ensureViewerKey = () => {
	try {
		const existing = window.localStorage.getItem(VIEWER_KEY_STORAGE_KEY);
		if (existing) return existing;
		const created = randomId();
		window.localStorage.setItem(VIEWER_KEY_STORAGE_KEY, created);
		return created;
	} catch {
		return null;
	}
};

export function useViewTracking({
	videoId,
	enabled,
	playerRef,
}: {
	videoId: string;
	enabled: boolean;
	playerRef: RefObject<HTMLVideoElement | null>;
}) {
	const [ended, setEnded] = useState(false);
	const sessionIdRef = useRef<string | null>(null);
	const rangesRef = useRef<WatchRange[]>([]);
	const watchedRef = useRef(0);
	const lastTimeRef = useRef<number | null>(null);
	const metaRef = useRef({ position: 0, duration: 0 });

	const send = useCallback(
		(payload: Record<string, unknown>, preferBeacon: boolean) => {
			const url = `/s/${encodeURIComponent(videoId)}/view`;
			const body = JSON.stringify(payload);
			if (preferBeacon && typeof navigator.sendBeacon === "function") {
				let queued = false;
				try {
					queued = navigator.sendBeacon(
						url,
						new Blob([body], { type: "application/json" }),
					);
				} catch {
					queued = false;
				}
				if (queued) return;
			}
			void fetch(url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body,
				keepalive: true,
			}).catch(() => undefined);
		},
		[videoId],
	);

	const flush = useCallback(
		(preferBeacon: boolean) => {
			const sessionId = sessionIdRef.current;
			if (!enabled || !sessionId) return;
			const ranges = rangesRef.current;
			const watched = watchedRef.current;
			if (ranges.length === 0 && watched <= 0) return;
			rangesRef.current = [];
			watchedRef.current = 0;
			send(
				{
					event: "progress",
					sessionId,
					ranges,
					watchedSeconds: watched,
					position: metaRef.current.position,
					duration: metaRef.current.duration,
				},
				preferBeacon,
			);
		},
		[enabled, send],
	);

	useEffect(() => {
		if (!enabled) return;
		const sessionId = ensureAnalyticsSessionId();
		if (sessionId === "anonymous") return;
		sessionIdRef.current = sessionId;
		send(
			{
				event: "start",
				sessionId,
				viewerKey: ensureViewerKey(),
				referrer: document.referrer || null,
			},
			false,
		);
	}, [enabled, send]);

	useEffect(() => {
		let element: HTMLVideoElement | null = null;

		const addRange = (start: number, end: number) => {
			const ranges = rangesRef.current;
			const last = ranges[ranges.length - 1];
			if (last && Math.abs(last[1] - start) < 0.01) last[1] = end;
			else ranges.push([start, end]);
		};

		const onTimeUpdate = () => {
			if (!element) return;
			const time = element.currentTime;
			const duration = Number.isFinite(element.duration)
				? element.duration
				: metaRef.current.duration;
			metaRef.current = { position: time, duration };
			const previous = lastTimeRef.current;
			lastTimeRef.current = time;
			if (previous === null || element.paused || element.seeking) return;
			const step = time - previous;
			const rate = element.playbackRate > 0 ? element.playbackRate : 1;
			if (step > 0 && step <= MAX_CONTINUOUS_STEP_SECONDS * Math.max(1, rate)) {
				addRange(previous, time);
				watchedRef.current += step / rate;
			}
		};
		const onSeeking = () => {
			lastTimeRef.current = null;
		};
		const onPlay = () => {
			setEnded(false);
			lastTimeRef.current = element?.currentTime ?? null;
		};
		const onPause = () => flush(false);
		const onEnded = () => {
			if (element && Number.isFinite(element.duration)) {
				const previous = lastTimeRef.current;
				if (previous !== null && element.duration - previous < 1.5) {
					addRange(previous, element.duration);
				}
			}
			lastTimeRef.current = null;
			setEnded(true);
			flush(false);
		};

		const events: Array<[string, () => void]> = [
			["timeupdate", onTimeUpdate],
			["seeking", onSeeking],
			["play", onPlay],
			["pause", onPause],
			["ended", onEnded],
		];
		const attach = (next: HTMLVideoElement | null) => {
			if (next === element) return;
			if (element) {
				for (const [name, handler] of events) {
					element.removeEventListener(name, handler);
				}
			}
			element = next;
			lastTimeRef.current =
				element && !element.paused ? element.currentTime : null;
			if (element) {
				for (const [name, handler] of events) {
					element.addEventListener(name, handler);
				}
			}
		};
		const locate = () =>
			attach(
				playerRef.current ??
					(document.querySelector("video") as HTMLVideoElement | null),
			);

		locate();
		const poll = window.setInterval(locate, ELEMENT_POLL_MS);
		const flushTimer = window.setInterval(
			() => flush(false),
			FLUSH_INTERVAL_MS,
		);
		const onHidden = () => {
			if (document.visibilityState === "hidden") flush(true);
		};
		const onPageHide = () => flush(true);
		document.addEventListener("visibilitychange", onHidden);
		window.addEventListener("pagehide", onPageHide);

		return () => {
			window.clearInterval(poll);
			window.clearInterval(flushTimer);
			document.removeEventListener("visibilitychange", onHidden);
			window.removeEventListener("pagehide", onPageHide);
			flush(true);
			attach(null);
		};
	}, [flush, playerRef]);

	const trackCtaClick = useCallback(() => {
		const sessionId = sessionIdRef.current;
		if (!enabled || !sessionId) return;
		send({ event: "cta", sessionId }, true);
	}, [enabled, send]);

	return { ended, trackCtaClick };
}
