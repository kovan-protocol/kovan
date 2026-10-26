import type { Metadata } from "next";
import { AgentExample } from "@/components/marketing/agent-example";

export const metadata: Metadata = {
  title: "Try with your agent",
  description: "Copy a small Node.js example for an agent to request an x402 resource through Kovan, then preview how its spending rules respond.",
};

export default function Page() { return <AgentExample />; }
