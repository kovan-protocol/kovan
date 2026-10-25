import type { Metadata } from "next";
import { DevelopersContent } from "@/components/marketing/technical-pages";
export const metadata: Metadata = { title: "Developers", description: "Inspect Kovan's source, deployed Stellar testnet contracts and recorded transactions." };
export default function Page() { return <DevelopersContent />; }
