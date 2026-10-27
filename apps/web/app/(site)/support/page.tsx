import type { Metadata } from "next";
import { SupportPage } from "@/components/pages/SupportPage";

export const metadata: Metadata = {
	title: "Support — RocStarr VideoShare",
	description:
		"Get help with RocStarr VideoShare. Join our Discord community, email support@cap.so, read the docs, or report an issue on GitHub.",
};

export default function App() {
	return <SupportPage />;
}
