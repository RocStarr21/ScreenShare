import type { Metadata } from "next";
import { ImportPage } from "./ImportPage";

export const metadata: Metadata = {
	title: "Import — RocStarr VideoShare",
};

export default function Page() {
	return <ImportPage />;
}
