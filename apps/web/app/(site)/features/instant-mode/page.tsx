import type { Metadata } from "next";
import { InstantModePage } from "./InstantModePage";

export const metadata: Metadata = {
	title: "Instant Mode - Quick Screen Recording & Sharing | RocStarr VideoShare",
	description:
		"Record and share instantly with RocStarr VideoShare's cloud-powered Instant Mode. Get automatic transcriptions, collaborative comments, shareable links, and team workspaces for fast feedback loops.",
	openGraph: {
		title: "Instant Mode - Quick Screen Recording & Sharing | RocStarr VideoShare",
		description:
			"Record and share instantly with RocStarr VideoShare's cloud-powered Instant Mode. Get automatic transcriptions, collaborative comments, shareable links, and team workspaces for fast feedback loops.",
		url: "https://cap.so/features/instant-mode",
		siteName: "RocStarr VideoShare",
		images: [
			{
				url: "https://cap.so/og.png",
				width: 1200,
				height: 630,
				alt: "RocStarr VideoShare Instant Mode",
			},
		],
		locale: "en_US",
		type: "website",
	},
	twitter: {
		card: "summary_large_image",
		title: "Instant Mode - Quick Screen Recording & Sharing | RocStarr VideoShare",
		description:
			"Record and share instantly with RocStarr VideoShare's cloud-powered Instant Mode. Get automatic transcriptions, collaborative comments, shareable links, and team workspaces for fast feedback loops.",
		images: ["https://cap.so/og.png"],
	},
};

export default function Page() {
	return <InstantModePage />;
}
