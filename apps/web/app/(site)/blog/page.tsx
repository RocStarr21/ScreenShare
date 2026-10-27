import type { Metadata } from "next";
import { UpdatesPage } from "@/components/pages/UpdatesPage";

export const metadata: Metadata = {
	title: "Blog — RocStarr VideoShare",
};

export default function App() {
	return <UpdatesPage />;
}
