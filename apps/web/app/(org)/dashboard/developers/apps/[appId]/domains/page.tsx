import type { Metadata } from "next";
import { DomainsClient } from "./DomainsClient";

export const metadata: Metadata = {
	title: "Allowed Domains — RocStarr VideoShare",
};

export default async function DomainsPage() {
	return <DomainsClient />;
}
