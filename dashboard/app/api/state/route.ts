import { NextResponse } from "next/server";
import { jsonSafe, listAgents, readAgent, readPool, readYield, usdcBalance } from "@/lib/contracts";
import { configuredVaults } from "@/lib/yield";
import { assertKovanPool, ids, knownPools, rpcServer, withRetry } from "@/lib/stellar";
import { defaultKeystore } from "@/lib/keystore";
import { onchainSigner } from "@/lib/agent";
import { agentSigning } from "@/lib/key-access";
import { Keypair } from "@stellar/stellar-sdk";

export async function GET(req: Request) {
  try {
    const poolId = new URL(req.url).searchParams.get("pool");
    await assertKovanPool(ids(poolId).pool);
    const [pool, agentIds, latest] = await Promise.all([readPool(poolId), listAgents(poolId), withRetry(() => rpcServer().getLatestLedger())]);
    const keys = defaultKeystore().list();
    let fallbackPubkeyHex: string | undefined;
    try {
      if (process.env.AGENT_SECRET?.trim()) fallbackPubkeyHex = Keypair.fromSecret(process.env.AGENT_SECRET.trim()).rawPublicKey().toString("hex");
    } catch { /* A malformed optional legacy key is handled when signing. */ }
    const agents = await Promise.all(
      agentIds.map(async (id) => {
        const [rec, balance, signer] = await Promise.all([readAgent(id, poolId), usdcBalance(id), onchainSigner(id)]);
        return { id, balance, ...rec, signing: agentSigning(signer.pubkeyHex, pool.owner, keys, fallbackPubkeyHex) };
      }),
    );
    const balance = pool.balance ?? await usdcBalance(ids(poolId).pool);
    let yieldInfo;
    let yieldError;
    if ((pool.accounting_version ?? 1) >= 3) {
      try { yieldInfo = await readYield(ids(poolId).pool); }
      catch { yieldError = "Yield state unavailable. Cash and agent recovery remain available; refresh to retry."; }
    }
    return NextResponse.json(jsonSafe({ ids: ids(poolId), knownPools: knownPools(), latestLedger: latest.sequence, pool: { ...pool, balance }, agents,
      yield: yieldInfo, yieldError, yieldVaults: configuredVaults(pool.usdc) }));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
