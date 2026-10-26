// Contract events → log rows. Server-side fetch via RPC getEvents plus a pure
// normalizer (tested) that the client never needs to reimplement.
import { Address, scValToNative, xdr } from "@stellar/stellar-sdk";
import { rpcServer, withRetry } from "./stellar";

export type RawEvent = { ledger: number; txHash: string; contractId: string; topic: string[]; value: string };

export type LogEvent = {
  ledger: number;
  txHash: string;
  source: "pool" | "covenant" | "other";
  kind: string;
  agent?: string;
  vault?: string;
  action?: string;
  data: Record<string, unknown> | unknown;
};

function native(b64: string): unknown {
  try {
    const v = scValToNative(xdr.ScVal.fromXDR(b64, "base64"));
    return typeof v === "bigint" ? v.toString() : v;
  } catch {
    return undefined;
  }
}

function jsonSafe(v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  if (Buffer.isBuffer(v)) return v.toString("hex");
  if (Array.isArray(v)) return v.map(jsonSafe);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, jsonSafe(x)]));
  return v;
}

export function normalizeEvent(e: RawEvent, idsIn: { pool: string; policy: string }): LogEvent {
  const source: LogEvent["source"] = e.contractId === idsIn.pool ? "pool" : e.contractId === idsIn.policy ? "covenant" : "other";
  let kind = "other";
  let agent: string | undefined;
  let vault: string | undefined;
  let action: string | undefined;
  try {
    const t0 = xdr.ScVal.fromXDR(e.topic[0], "base64");
    if (t0.switch() === xdr.ScValType.scvSymbol()) kind = t0.sym().toString();
    if (e.topic[1] && kind !== "pool_closed") {
      const t1 = xdr.ScVal.fromXDR(e.topic[1], "base64");
      if (t1.switch() === xdr.ScValType.scvAddress()) {
        const address = Address.fromScVal(t1).toString();
        if (kind === "yield_configured" || kind === "yield_movement") vault = address;
        else agent = address;
      }
    }
    if (kind === "yield_movement" && e.topic[2]) action = String(native(e.topic[2]));
  } catch {
    kind = "other";
  }
  if (source === "other") kind = "other";
  return { ledger: e.ledger, txHash: e.txHash, source, kind, agent, vault, action, data: jsonSafe(native(e.value)) };
}

export type EventsPage = { events: LogEvent[]; latestLedger: number; oldestLedger: number; truncated: boolean };

/** Ledger encoded in an RPC events cursor ("<toid>-<idx>"): toid >> 32. */
export function cursorLedger(cursor: string): number {
  return Number(BigInt(cursor.split("-")[0]) >> 32n);
}

/** Start of the window, clamped to what the RPC still retains. */
export function clampWindow(a: { latest: number; span: number; oldestAvailable: number }): { start: number; truncated: boolean } {
  const wanted = Math.max(1, a.latest - a.span);
  return wanted < a.oldestAvailable ? { start: a.oldestAvailable, truncated: true } : { start: wanted, truncated: false };
}

/**
 * Last `span` ledgers of pool + policy events. RPC scans a bounded window per
 * call and hands back a cursor, so we page until the cursor passes `latest`.
 */
export async function fetchEvents(idsIn: { pool: string; policy: string }, span = 17_280, maxPages = 12): Promise<EventsPage> {
  const server = rpcServer();
  const health = await withRetry(() => server.getHealth());
  const latest = health.latestLedger ?? (await withRetry(() => server.getLatestLedger())).sequence;
  const { start, truncated } = clampWindow({ latest, span, oldestAvailable: health.oldestLedger ?? 1 });
  const filters = [{ type: "contract" as const, contractIds: [idsIn.pool, idsIn.policy] }];
  const raw: RawEvent[] = [];
  let oldest = start;
  let cursor: string | undefined;
  for (let i = 0; i < maxPages; i++) {
    const page = await withRetry(() =>
      cursor ? server.getEvents({ cursor, filters, limit: 200 }) : server.getEvents({ startLedger: start, filters, limit: 200 }),
    );
    oldest = (page as unknown as { oldestLedger?: number }).oldestLedger ?? oldest;
    for (const ev of page.events) {
      raw.push({
        ledger: ev.ledger,
        txHash: ev.txHash,
        contractId: ev.contractId?.toString() ?? "",
        topic: ev.topic.map((t) => t.toXDR("base64")),
        value: ev.value.toXDR("base64"),
      });
    }
    const next = (page as unknown as { cursor?: string }).cursor;
    if (!next || cursorLedger(next) >= latest) break;
    cursor = next;
  }
  const events = raw.map((e) => normalizeEvent(e, idsIn));
  return { events: events.reverse(), latestLedger: latest, oldestLedger: oldest, truncated: truncated || oldest > start };
}
