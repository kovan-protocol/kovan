import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { StrKey } from "@stellar/stellar-sdk";
import { ids, rejectCrossSite } from "@/lib/stellar";
import { discoverTerms, payEndpoint, publicTerms } from "@/lib/agent-x402";
import { paymentJournal } from "@/lib/x402-journal";
import { paymentUrl } from "@/lib/x402";

// The console holds agent keys. It is a local tool, not an unauthenticated public API.
function localOnly(req: Request): string | null {
  try {
    const target = new URL(req.url);
    const host = req.headers.get("host");
    const hosts = [target.hostname, ...(host ? [new URL(`http://${host}`).hostname] : [])];
    if (hosts.some((h) => !["localhost", "127.0.0.1", "[::1]"].includes(h))) return "x402 signing is available only through the local console";
    const origin = req.headers.get("origin");
    // Next can reconstruct req.url with its internal localhost hostname. Compare
    // the browser's origin with the validated incoming Host, not that alias.
    if (origin && (new URL(origin).host !== (host ?? target.host) || new URL(origin).protocol !== target.protocol)) return "Cross-origin x402 request refused";
    const site = req.headers.get("sec-fetch-site");
    if (site && site !== "same-origin" && site !== "none") return "Cross-site x402 request refused";
    return null;
  } catch { return "Invalid request origin"; }
}

async function readBody(req: Request): Promise<unknown> {
  const reader = req.body?.getReader();
  if (!reader) throw new Error("Payment request body required");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) { await reader.cancel(); throw new Error("Payment request too large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
}

/** GET ?url= → reviewed quote. POST adds mandateId for mandate-enabled accounts. */
export async function GET(req: Request) {
  const refused = localOnly(req);
  if (refused) return NextResponse.json({ error: refused }, { status: 403 });
  const url = new URL(req.url).searchParams.get("url");
  if (!url) return NextResponse.json({ error: "url required" }, { status: 400 });
  try {
    const t = await discoverTerms(url);
    return NextResponse.json(publicTerms(t), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 422 });
  }
}

export async function POST(req: Request) {
  const refused = localOnly(req) || rejectCrossSite(req);
  if (refused) return NextResponse.json({ error: refused }, { status: 403 });
  try {
    const body = await readBody(req);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid payment request");
    const { agent, url: rawUrl, pool, quoteId, requestId, mandateId } = body as Record<string, unknown>;
    if (Object.keys(body).some((key) => !["agent", "url", "pool", "quoteId", "requestId", "mandateId"].includes(key))) throw new Error("Unsupported payment request field");
    if (typeof agent !== "string" || !StrKey.isValidContract(agent) || typeof rawUrl !== "string"
        || (pool !== undefined && (typeof pool !== "string" || !StrKey.isValidContract(pool)))
        || (mandateId !== undefined && (typeof mandateId !== "string" || !/^[a-f0-9]{64}$/.test(mandateId) || /^0{64}$/.test(mandateId)))
        || typeof quoteId !== "string" || !/^[a-f0-9]{64}$/.test(quoteId) || typeof requestId !== "string") {
      return NextResponse.json({ error: "Valid agent, url, quoteId and requestId are required; read terms first" }, { status: 400 });
    }
    const url = paymentUrl(rawUrl);
    const selectedPool = ids(pool).pool;
    // Keep legacy fingerprints; a mandate selection is an additional bound input.
    const fingerprint = createHash("sha256").update(JSON.stringify(["kovan:x402:request:v1", agent, url, selectedPool, quoteId, ...(mandateId ? [mandateId] : [])])).digest("hex");
    const r = await paymentJournal().run(requestId, fingerprint, () => payEndpoint(agent, url, { pool: selectedPool, quoteId, ...(mandateId ? { mandateId, requestId } : {}) }));
    return NextResponse.json(r, { status: r.ok ? 200 : 422 });
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.json({ ok: false, stage: "guard", error: msg }, { status: /pending|interrupted|already used/.test(msg) ? 409 : 400 });
  }
}
