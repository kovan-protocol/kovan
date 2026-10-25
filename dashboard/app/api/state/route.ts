import { NextResponse } from "next/server";
import { jsonSafe, listAgents, readAgent, readPool, usdcBalance } from "@/lib/contracts";
import { ids, rpcServer } from "@/lib/stellar";

export async function GET() {
  try {
    const [pool, agentIds, latest] = await Promise.all([readPool(), listAgents(), rpcServer().getLatestLedger()]);
    const agents = await Promise.all(
      agentIds.map(async (id) => {
        const [rec, balance] = await Promise.all([readAgent(id), usdcBalance(id).catch(() => 0n)]);
        return { id, balance, ...rec };
      }),
    );
    return NextResponse.json(jsonSafe({ ids: ids(), latestLedger: latest.sequence, pool, agents }));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
