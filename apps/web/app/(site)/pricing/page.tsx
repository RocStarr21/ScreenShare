import type { Metadata } from "next";
import { PricingPage } from "@/components/pages/PricingPage";

export const metadata: Metadata = {
	title: "Pricing — RocStarr VideoShare",
};

export default function App() {
	return <PricingPage />;
}
