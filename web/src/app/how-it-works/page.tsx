import type { Metadata } from "next";
import { HowContent } from "@/components/marketing/site-pages";
export const metadata: Metadata = { title: "How it works", description: "From a shared USDC pool to agent budgets and checked payments. Explore the Kovan flow in three steps." };
export default function Page() { return <HowContent />; }
