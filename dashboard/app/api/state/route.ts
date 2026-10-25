import { NextResponse } from "next/server";
import { jsonSafe, listAgents, readAgent, readPool, usdcBalance } from "@/lib/contracts";
import { assertKovanPool, ids, rpcServer, withRetry } from "@/lib/stellar";

export async function GET(req: Request) {
  try {
    const poolId = new URL(req.url).searchParams.get("pool");
    if (poolId) await assertKovanPool(ids(poolId).pool);
    const [pool, agentIds, latest] = await Promise.all([readPool(poolId), listAgents(poolId), withRetry(() => rpcServer().getLatestLedger())]);
    const agents = await Promise.all(
      agentIds.map(async (id) => {
        const [rec, balance] = await Promise.all([readAgent(id, poolId), usdcBalance(id).catch(() => 0n)]);
        return { id, balance, ...rec };
      }),
    );
    return NextResponse.json(jsonSafe({ ids: ids(poolId), latestLedger: latest.sequence, pool, agents }));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
