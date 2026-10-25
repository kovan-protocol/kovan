import type { Metadata } from "next";
import { WhyContent } from "@/components/marketing/site-pages";
export const metadata: Metadata = { title: "Why Kovan", description: "Shared budgets, account-level spending rules, bounded delegation and owner control for AI agents." };
export default function Page() { return <WhyContent />; }
