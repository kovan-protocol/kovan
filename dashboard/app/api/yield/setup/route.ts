import { NextResponse } from "next/server";
import { StrKey } from "@stellar/stellar-sdk";
import { jsonSafe, transactionStatus } from "@kovan-protocol/sdk";
import { inspectYieldVault, nativeVaultFromReceipt, prepareActivateNativeVault, prepareNativeVault, reviewedYieldVaults } from "@kovan-protocol/sdk/experimental";
import { deployments } from "@/lib/deployments";
import { nativeYieldSource } from "@/lib/native-yield";
import { NETWORK_PASSPHRASE, rejectCrossSite, rpcServer } from "@/lib/stellar";

export async function POST(req: Request) {
  const refused = rejectCrossSite(req);
  if (refused) return NextResponse.json({ error: refused }, { status: 403 });
  try {
    const body = await req.json();
    if (!body || typeof body !== "object" || Object.keys(body).some(k => !["action", "manager", "amount", "creationHash", "hash"].includes(k))
      || !["create", "activate", "inspect", "transaction"].includes(body.action)) throw new Error("Invalid native yield setup request");
    const ctx = { rpc: rpcServer(), networkPassphrase: NETWORK_PASSPHRASE };
    if (body.action === "transaction") {
      return NextResponse.json(jsonSafe(await transactionStatus(ctx, body.hash)), { headers: { "Cache-Control": "no-store" } });
    }
    if (typeof body.manager !== "string" || !StrKey.isValidEd25519PublicKey(body.manager)) throw new Error("Connect the vault manager's account");
    const source = nativeYieldSource();
    if (body.action === "create") {
      const prepared = await prepareNativeVault(ctx, source, body.manager, body.amount);
      return NextResponse.json({ xdr: prepared.xdr, hash: prepared.hash });
    }
    const vault = await nativeVaultFromReceipt(ctx, source, body.manager, body.creationHash);
    if (body.action === "activate") {
      const prepared = await prepareActivateNativeVault(ctx, vault, body.manager, body.amount);
      return NextResponse.json({ xdr: prepared.xdr, hash: prepared.hash });
    }
    const state = await inspectYieldVault(ctx, vault);
    const enabled = reviewedYieldVaults(deployments(), source.usdc).some(v => v.vault === vault.vault && v.wasm_hash === vault.wasm_hash);
    return NextResponse.json(jsonSafe({ vault, state, enabled }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 422 });
  }
}
