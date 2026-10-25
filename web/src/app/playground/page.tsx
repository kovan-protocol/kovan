import type { Metadata } from "next";
import { PlaygroundContent } from "@/components/marketing/site-pages";
export const metadata: Metadata = { title: "Interactive demo", description: "Try Kovan spending rules in an interactive simulation. Test payment caps, recipient permissions and owner revocation." };
export default function Page() { return <PlaygroundContent />; }
