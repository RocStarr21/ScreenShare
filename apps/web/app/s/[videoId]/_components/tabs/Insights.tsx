"use client";

import type { Video } from "@cap/web-domain";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { MousePointerClick, RefreshCw, UserRound } from "lucide-react";
import { getVideoInsights } from "@/actions/videos/share-options";

const RETENTION_BARS = 20;
const REFRESH_INTERVAL_MS = 30_000;

const percent = (value: number) => `${Math.round(value * 100)}%`;

const formatWatchTime = (seconds: number) => {
	if (seconds < 60) return `${Math.round(seconds)}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ${Math.round(seconds % 60)}s`;
	return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

const groupRetention = (curve: number[]) => {
	const size = Math.max(1, Math.floor(curve.length / RETENTION_BARS));
	const bars: Array<{ start: number; end: number; value: number }> = [];
	for (let i = 0; i < curve.length; i += size) {
		const slice = curve.slice(i, i + size);
		bars.push({
			start: i,
			end: Math.min(curve.length, i + size),
			value: slice.reduce((sum, v) => sum + v, 0) / slice.length,
		});
	}
	return bars;
};

function Stat({
	label,
	value,
	hint,
}: {
	label: string;
	value: string;
	hint?: string;
}) {
	return (
		<div className="flex flex-col gap-0.5 p-3 rounded-xl border border-gray-4 bg-gray-1">
			<span className="text-xs text-gray-10">{label}</span>
			<span className="text-lg font-semibold text-gray-12">{value}</span>
			{hint && <span className="text-[11px] text-gray-9">{hint}</span>}
		</div>
	);
}

export function Insights({ videoId }: { videoId: Video.VideoId }) {
	const insights = useQuery({
		queryKey: ["videoInsights", videoId],
		queryFn: () => getVideoInsights(videoId),
		refetchInterval: REFRESH_INTERVAL_MS,
	});

	if (insights.isLoading) {
		return (
			<div className="p-4 space-y-3 animate-pulse">
				<div className="grid grid-cols-2 gap-2">
					{[0, 1, 2, 3].map((i) => (
						<div key={i} className="h-16 rounded-xl bg-gray-3" />
					))}
				</div>
				<div className="h-24 rounded-xl bg-gray-3" />
			</div>
		);
	}

	if (insights.isError || !insights.data) {
		return (
			<div className="p-4 text-sm text-gray-10">
				Insights are not available right now.
			</div>
		);
	}

	const { summary, retention, viewers } = insights.data;
	const bars = groupRetention(retention);

	return (
		<div className="flex flex-col gap-4 p-4">
			<div className="flex justify-between items-center">
				<h3 className="text-sm font-semibold text-gray-12">Viewer insights</h3>
				<button
					type="button"
					onClick={() => insights.refetch()}
					className="p-1.5 rounded-lg text-gray-10 hover:bg-gray-3 hover:text-gray-12"
					aria-label="Refresh insights"
				>
					<RefreshCw
						className={`size-3.5 ${insights.isFetching ? "animate-spin" : ""}`}
					/>
				</button>
			</div>

			<div className="grid grid-cols-2 gap-2">
				<Stat label="Views" value={String(summary.views)} />
				<Stat label="Unique viewers" value={String(summary.uniqueViewers)} />
				<Stat
					label="Avg. watched"
					value={percent(summary.averageCompletion)}
					hint={`${summary.completedViews} finished`}
				/>
				<Stat
					label="Total watch time"
					value={formatWatchTime(summary.totalWatchSeconds)}
				/>
				{summary.ctaClicks > 0 && (
					<Stat
						label="Button clicks"
						value={String(summary.ctaClicks)}
						hint={`${percent(summary.ctaClickRate)} of views`}
					/>
				)}
			</div>

			<div className="flex flex-col gap-2">
				<span className="text-xs font-medium text-gray-11">
					Where viewers dropped off
				</span>
				<div
					className="flex gap-0.5 items-end h-20 p-2 rounded-xl border border-gray-4 bg-gray-1"
					role="img"
					aria-label="Share of views that reached each part of the video"
				>
					{bars.map((bar) => (
						<div
							key={bar.start}
							className="flex-1 rounded-sm bg-blue-500/80"
							style={{ height: `${Math.max(2, Math.round(bar.value * 100))}%` }}
							title={`${bar.start}–${bar.end}% of the video: ${percent(bar.value)} of views`}
						/>
					))}
				</div>
				<div className="flex justify-between text-[11px] text-gray-9">
					<span>Start</span>
					<span>End</span>
				</div>
			</div>

			<div className="flex flex-col gap-2">
				<span className="text-xs font-medium text-gray-11">
					Who watched ({viewers.length})
				</span>
				{viewers.length === 0 ? (
					<p className="text-sm text-gray-10">
						No views yet. Views from you, the owner, are not counted.
					</p>
				) : (
					<ul className="flex flex-col divide-y divide-gray-4 rounded-xl border border-gray-4">
						{viewers.map((viewer) => (
							<li key={viewer.id} className="flex gap-3 items-start p-3">
								<UserRound
									className={`mt-0.5 size-4 shrink-0 ${viewer.identified ? "text-blue-500" : "text-gray-8"}`}
									aria-hidden
								/>
								<div className="flex flex-col flex-1 gap-0.5 min-w-0">
									<div className="flex gap-2 justify-between items-center">
										<span className="text-sm font-medium truncate text-gray-12">
											{viewer.label}
										</span>
										<span className="text-xs font-semibold text-gray-12 shrink-0">
											{viewer.watchedPercent}%
										</span>
									</div>
									{viewer.email && viewer.email !== viewer.label && (
										<span className="text-xs truncate text-gray-10">
											{viewer.email}
										</span>
									)}
									<div className="h-1 rounded-full bg-gray-4">
										<div
											className="h-1 rounded-full bg-blue-500"
											style={{ width: `${viewer.watchedPercent}%` }}
										/>
									</div>
									<span className="text-[11px] text-gray-9">
										{[
											formatDistanceToNow(new Date(viewer.lastSeenAt), {
												addSuffix: true,
											}),
											viewer.location,
											viewer.device,
										]
											.filter(Boolean)
											.join(" · ")}
									</span>
									{viewer.ctaClicks > 0 && (
										<span className="inline-flex gap-1 items-center text-[11px] font-medium text-blue-600">
											<MousePointerClick className="size-3" aria-hidden />
											Clicked your button
										</span>
									)}
								</div>
							</li>
						))}
					</ul>
				)}
			</div>
		</div>
	);
}
