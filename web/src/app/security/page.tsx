import type { Metadata } from "next";
import { SecurityContent } from "@/components/marketing/technical-pages";
export const metadata: Metadata = { title: "Security", description: "Understand Kovan's account-level permissions, spending caps and owner controls. Unaudited Stellar testnet prototype." };
export default function Page() { return <SecurityContent />; }
