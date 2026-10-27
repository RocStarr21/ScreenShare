import type { Metadata } from "next";
import { EmployeeOnboardingPlatformPage } from "@/components/pages/seo/EmployeeOnboardingPlatformPage";

export const metadata: Metadata = {
	title: "Employee Onboarding Platform: Streamline New-Hire Training with RocStarr VideoShare",
	description:
		"Looking for a powerful employee onboarding platform? Discover how RocStarr VideoShare's open-source screen recorder and asynchronous features simplify new-hire training.",
	openGraph: {
		title:
			"Employee Onboarding Platform: Streamline New-Hire Training with RocStarr VideoShare",
		description:
			"Looking for a powerful employee onboarding platform? Discover how RocStarr VideoShare's open-source screen recorder and asynchronous features simplify new-hire training.",
		url: "https://cap.so/solutions/employee-onboarding-platform",
		siteName: "RocStarr VideoShare",
		images: [
			{
				url: "https://cap.so/og.png",
				width: 1200,
				height: 630,
				alt: "RocStarr VideoShare: Employee Onboarding Platform",
			},
		],
		locale: "en_US",
		type: "website",
	},
	twitter: {
		card: "summary_large_image",
		title: "Employee Onboarding Platform | RocStarr VideoShare Screen Recorder",
		description:
			"Discover how RocStarr VideoShare's open-source screen recorder simplifies new-hire training with asynchronous video and built-in feedback.",
		images: ["https://cap.so/og.png"],
	},
	alternates: {
		canonical: "https://cap.so/solutions/employee-onboarding-platform",
	},
};

export default EmployeeOnboardingPlatformPage;
