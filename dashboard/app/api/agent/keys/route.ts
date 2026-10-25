import { NextResponse } from "next/server";
import { defaultKeystore } from "@/lib/keystore";
import { defaultKeyChallenges } from "@/lib/key-challenges";
import { assertKovanPool, ids, rejectCrossSite } from "@/lib/stellar";
import { addr, readPool, simulateRead } from "@/lib/contracts";
import { onchainSigner } from "@/lib/agent";
import { StrKey } from "@stellar/stellar-sdk";

const headers = { "Cache-Control": "no-store", "Pragma": "no-cache" };

async function checkOwner(pool: string, owner: string) {
  if (!StrKey.isValidEd25519PublicKey(owner)) throw new Error("Connect the pool owner's G… wallet");
  await assertKovanPool(pool);
  if ((await readPool(pool)).owner !== owner) throw new Error("Key authorization needs the pool owner");
}

async function checkAgent(pool: string, agent: string) {
  if (!StrKey.isValidContract(agent)) throw new Error("Agent must be a C… smart account");
  // A real Kovan pool must know this agent; an arbitrary account is not enough.
  await simulateRead(pool, "get_agent", [addr(agent)]);
  const signer = await onchainSigner(agent);
  if (signer.verifier !== ids(pool).verifier) throw new Error("Agent uses a different signer verifier");
  return signer.pubkeyHex;
}

/** Public metadata only. Private-key export is a separate, signed POST action. */
export async function GET() {
  return NextResponse.json({ keys: defaultKeystore().list() }, { headers });
}

export async function POST(req: Request) {
  const refused = rejectCrossSite(req);
  if (refused) return NextResponse.json({ error: refused }, { status: 403, headers });
  try {
    const body = await req.json() as Record<string, unknown>;
    const field = (name: string) => typeof body[name] === "string" ? body[name] as string : "";
    const action = field("action");
    const origin = new URL(req.url).origin;
    const challenges = defaultKeyChallenges();
    const keys = defaultKeystore();
    if (action === "generate-challenge" || action === "export-challenge") {
      const pool = ids(field("pool")).pool;
      const owner = field("owner");
      await checkOwner(pool, owner);
      let agent: string | undefined;
      let pubkeyHex: string | undefined;
      if (action === "export-challenge") {
        agent = field("agent");
        pubkeyHex = await checkAgent(pool, agent);
        const key = keys.list().find((k) => k.pubkeyHex === pubkeyHex);
        if (!key?.owner || key.owner !== owner) throw new Error("This signer key is external or was not generated for this wallet; it cannot be exported here");
      }
      const challenge = challenges.create({ intent: action === "generate-challenge" ? "generate" : "export", owner, pool, origin, agent, pubkeyHex });
      return NextResponse.json({ id: challenge.id, message: challenge.message, expiresAt: challenge.expiresAt }, { headers });
    }
    if (action === "generate" || action === "export") {
      const challenge = challenges.consume(field("challengeId"), field("signature"), action, origin);
      await checkOwner(challenge.pool, challenge.owner);
      if (action === "generate") {
        return NextResponse.json(keys.generate((field("label") || "agent").slice(0, 40), challenge.owner), { headers });
      }
      const pubkeyHex = await checkAgent(challenge.pool, challenge.agent!);
      if (pubkeyHex !== challenge.pubkeyHex) throw new Error("The agent signer changed; request a new export");
      const exported = keys.exportForOwner(pubkeyHex, challenge.owner);
      return NextResponse.json({ ...exported, agent: challenge.agent, pool: challenge.pool, network: "testnet" }, { headers });
    }
    return NextResponse.json({ error: "Choose a supported signer key action" }, { status: 400, headers });
  } catch (e) {
    // Never echo request bodies, signatures, filesystem errors or key material.
    const message = (e as Error).message ?? "Key request failed";
    const known = /authorization|pool owner|signer key|signer changed|signer verifier|Agent must|Connect the pool|pending key requests|Keystore is busy/.test(message);
    return NextResponse.json({ error: known ? message : "Could not process this key request; check the pool and try again" }, { status: known ? 403 : 400, headers });
  }
}
