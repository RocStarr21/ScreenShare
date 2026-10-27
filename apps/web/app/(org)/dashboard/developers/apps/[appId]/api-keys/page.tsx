import type { Metadata } from "next";
import { ApiKeysClient } from "./ApiKeysClient";

export const metadata: Metadata = {
	title: "API Keys — RocStarr VideoShare",
};

export default async function ApiKeysPage() {
	return <ApiKeysClient />;
}
