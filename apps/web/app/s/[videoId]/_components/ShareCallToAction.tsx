"use client";

import { ArrowUpRight, RotateCcw } from "lucide-react";

export type CallToAction = { text: string; url: string };

export function CallToActionButton({
	cta,
	onClick,
	className = "",
}: {
	cta: CallToAction;
	onClick: () => void;
	className?: string;
}) {
	return (
		<a
			href={cta.url}
			target="_blank"
			rel="noopener noreferrer"
			onClick={onClick}
			className={`inline-flex gap-2 justify-center items-center px-5 h-11 text-sm font-semibold text-white bg-blue-600 rounded-full shadow-sm transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 ${className}`}
		>
			<span className="truncate max-w-[16rem]">{cta.text}</span>
			<ArrowUpRight className="size-4 shrink-0" aria-hidden />
		</a>
	);
}

export function CallToActionBar({
	cta,
	onClick,
}: {
	cta: CallToAction;
	onClick: () => void;
}) {
	return (
		<div className="flex flex-wrap gap-3 justify-between items-center px-4 py-3 bg-white rounded-2xl border border-gray-5">
			<p className="text-sm text-gray-11">Ready for the next step?</p>
			<CallToActionButton cta={cta} onClick={onClick} />
		</div>
	);
}

export function CallToActionEndOverlay({
	cta,
	onClick,
	onReplay,
}: {
	cta: CallToAction;
	onClick: () => void;
	onReplay: () => void;
}) {
	return (
		<div className="flex absolute inset-0 z-20 flex-col gap-4 justify-center items-center rounded-xl bg-black/70 backdrop-blur-sm">
			<CallToActionButton cta={cta} onClick={onClick} />
			<button
				type="button"
				onClick={onReplay}
				className="inline-flex gap-1.5 items-center text-sm font-medium text-white/80 hover:text-white"
			>
				<RotateCcw className="size-3.5" aria-hidden />
				Watch again
			</button>
		</div>
	);
}
