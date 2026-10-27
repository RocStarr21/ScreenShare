import type { Metadata } from "next";
import {
	HowToScreenRecordPage,
	howToScreenRecordContent,
} from "@/components/pages/seo/HowToScreenRecordPage";
import { createFAQSchema, createHowToSchema } from "@/utils/web-schema";

export const metadata: Metadata = {
	title: "How to Screen Record on Mac, Windows & Chrome (2026 Guide) | RocStarr VideoShare",
	description:
		"Learn how to screen record with audio on Mac, Windows, and Chrome. Free step-by-step guide covering built-in tools and RocStarr VideoShare, the open-source screen recorder.",
	openGraph: {
		title: "How to Screen Record on Mac, Windows & Chrome (2026 Guide) | RocStarr VideoShare",
		description:
			"Learn how to screen record with audio on any platform. Step-by-step instructions for macOS, Windows, and Chrome with free and paid options.",
		url: "https://cap.so/how-to-screen-record",
		siteName: "RocStarr VideoShare",
		images: [
			{
				url: "https://cap.so/og.png",
				width: 1200,
				height: 630,
				alt: "How to Screen Record — Complete 2026 Guide by RocStarr VideoShare",
			},
		],
		locale: "en_US",
		type: "article",
	},
	twitter: {
		card: "summary_large_image",
		title: "How to Screen Record on Mac, Windows & Chrome (2026 Guide) | RocStarr VideoShare",
		description:
			"Learn how to screen record with audio on Mac, Windows, and Chrome. Free step-by-step guide.",
		images: ["https://cap.so/og.png"],
	},
	alternates: {
		canonical: "https://cap.so/how-to-screen-record",
	},
};

const howToSteps = [
	{
		name: "Download and install RocStarr VideoShare",
		text: "Download RocStarr VideoShare for free from cap.so/download for Mac or Windows, or use Instant Mode in your browser for quick recordings without any installation.",
	},
	{
		name: "Choose your recording settings",
		text: "Open RocStarr VideoShare and select your recording source. Choose between full screen, specific window, or custom region capture. Toggle microphone and system audio on or off based on your needs.",
	},
	{
		name: "Start recording your screen",
		text: "Click the record button to begin capturing your screen. RocStarr VideoShare records in high definition with minimal system impact so you can present, demo, or teach without lag.",
	},
	{
		name: "Share or export your recording",
		text: "Stop the recording when finished. RocStarr VideoShare generates an instant shareable link, or you can export the video locally in your preferred format. Share your recording with anyone in seconds.",
	},
];

export default function Page() {
	return (
		<>
			<script type="application/ld+json">
				{JSON.stringify(createFAQSchema(howToScreenRecordContent.faqs))}
			</script>
			<script type="application/ld+json">
				{JSON.stringify(
					createHowToSchema({
						name: "How to Screen Record on Mac, Windows & Chrome",
						description:
							"Learn how to screen record with audio on Mac, Windows, or in your browser using RocStarr VideoShare, the free open-source screen recorder.",
						totalTime: "PT2M",
						steps: howToSteps,
					}),
				)}
			</script>
			<HowToScreenRecordPage />
		</>
	);
}
