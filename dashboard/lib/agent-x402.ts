// Server-only: an agent account pays an x402 endpoint.
import { Address, Contract, Keypair, Operation, rpc, TransactionBuilder, xdr } from "@stellar/stellar-sdk";
import { assertAgentKeyMatches, env, onlyAgentEntry } from "./agent";
import { signAgentEntry } from "./authpayload";
import { explainError } from "./errors";
import { addrVal, i128Val } from "./scval";
import { ids, NETWORK_PASSPHRASE, rpcServer, withRetry } from "./stellar";
import {
  decodePaymentResponse,
  encodePaymentHeader,
  ledgerTimeout,
  parsePaymentRequired,
  pickStellarRequirement,
  REQ_HEADER,
  RES_HEADER,
  SIG_HEADER,
  type PaymentRequired,
  type PaymentRequirement,
} from "./x402";

export type Terms = { url: string; description?: string; payTo: string; amount: string; asset: string; maxTimeoutSeconds: number; pr: PaymentRequired; req: PaymentRequirement };

/** GET the endpoint and read its 402 terms. */
export async function discoverTerms(url: string): Promise<Terms> {
  if (!/^https:\/\//i.test(url)) throw new Error("endpoint must be an https:// URL");
  const r = await fetch(url, { method: "GET", redirect: "manual" });
  const h = r.headers.get(REQ_HEADER);
  if (r.status !== 402 || !h) throw new Error(`endpoint answered ${r.status} without ${REQ_HEADER}; not an x402 v2 resource`);
  const pr = parsePaymentRequired(h);
  const req = pickStellarRequirement(pr);
  return { url, description: pr.resource.description, payTo: req.payTo, amount: req.amount, asset: req.asset, maxTimeoutSeconds: req.maxTimeoutSeconds, pr, req };
}

export type X402Result =
  | { ok: true; status: number; txHash?: string; body: string; contentType: string | null; terms: Omit<Terms, "pr" | "req"> }
  | { ok: false; stage: "guard" | "terms" | "simulate" | "settle"; status?: number; error: string; raw?: string; terms?: Omit<Terms, "pr" | "req"> };

const strip = (t: Terms) => ({ url: t.url, description: t.description, payTo: t.payTo, amount: t.amount, asset: t.asset, maxTimeoutSeconds: t.maxTimeoutSeconds });

export async function payEndpoint(agent: string, url: string): Promise<X402Result> {
  const secret = env("AGENT_SECRET");
  const feePayer = Keypair.fromSecret(env("FEE_PAYER_SECRET"));
  const { verifier, usdc } = ids();
  const server = rpcServer();

  await assertAgentKeyMatches(agent, secret, verifier);

  let terms: Terms;
  try {
    terms = await discoverTerms(url);
  } catch (e) {
    return { ok: false, stage: "terms", error: (e as Error).message };
  }
  if (terms.asset !== usdc) return { ok: false, stage: "terms", error: `endpoint wants asset ${terms.asset}, agent holds USDC ${usdc}`, terms: strip(terms) };

  // transfer(from = agent, to = payTo, amount); fee payer is only the simulation source.
  const op = new Contract(usdc).call("transfer", addrVal(agent), addrVal(terms.payTo), i128Val(terms.amount));
  const latest = (await withRetry(() => server.getLatestLedger())).sequence;
  const source = await withRetry(() => server.getAccount(feePayer.publicKey()));
  const tx1 = new TransactionBuilder(source, { fee: "10000", networkPassphrase: NETWORK_PASSPHRASE }).addOperation(op).setTimeout(terms.maxTimeoutSeconds).build();
  const sim1 = await withRetry(() => server.simulateTransaction(tx1));
  if (rpc.Api.isSimulationError(sim1)) return { ok: false, stage: "simulate", error: explainError(sim1.error), raw: sim1.error, terms: strip(terms) };

  const expirationLedger = latest + ledgerTimeout(terms.maxTimeoutSeconds);
  const signed = ((sim1 as rpc.Api.SimulateTransactionSuccessResponse).result?.auth ?? []).map((e) =>
    onlyAgentEntry(e, agent, (entry) => signAgentEntry(entry, { verifier, secret, networkPassphrase: NETWORK_PASSPHRASE, expirationLedger })),
  );
  const source2 = await withRetry(() => server.getAccount(feePayer.publicKey()));
  const tx2 = new TransactionBuilder(source2, { fee: "10000", networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(Operation.invokeHostFunction({ func: op.body().invokeHostFunctionOp().hostFunction(), auth: signed }))
    .setTimeout(terms.maxTimeoutSeconds)
    .build();
  // Covenant check happens here, before the endpoint or facilitator see anything.
  const sim2 = await withRetry(() => server.simulateTransaction(tx2));
  if (rpc.Api.isSimulationError(sim2)) return { ok: false, stage: "simulate", error: explainError(sim2.error), raw: sim2.error, terms: strip(terms) };
  const prepared = rpc.assembleTransaction(tx2, sim2).build();

  const header = encodePaymentHeader(terms.pr, terms.req, prepared.toXDR());
  const r = await fetch(url, { method: "GET", headers: { [SIG_HEADER]: header }, redirect: "manual" });
  const body = await r.text();
  const settlement = decodePaymentResponse(r.headers.get(RES_HEADER));
  if (!r.ok) {
    return { ok: false, stage: "settle", status: r.status, error: settlement?.errorReason ?? `endpoint answered ${r.status}`, raw: body.slice(0, 500), terms: strip(terms) };
  }
  return { ok: true, status: r.status, txHash: settlement?.transaction, body: body.slice(0, 4000), contentType: r.headers.get("content-type"), terms: strip(terms) };
}
