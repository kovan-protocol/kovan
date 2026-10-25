import { describe, expect, it } from "vitest";
import { Address, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { normalizeEvent, type RawEvent } from "@/lib/events";

const POOL = "CAS7ARNTLTRAD4WLYGIXC5EVMFZBETIQROJ2UWOJGU4QQY5XQT3K2LKJ";
const POLICY = "CDEQUCR4OHOQHWPIP5RONRR46G7DTJMFZKNKRIQJCLYACDDZGWKAISD2";
const AGENT = "CAL7PY3A56BEDAN4QKNR5GPKK2UGXRHXG2Y3BX3XH5OHRPWGZS6JCCLZ";

const b64 = (v: xdr.ScVal) => v.toXDR("base64");
const sym = (s: string) => xdr.ScVal.scvSymbol(s);
const map = (o: Record<string, xdr.ScVal>) =>
  xdr.ScVal.scvMap(Object.keys(o).sort().map((k) => new xdr.ScMapEntry({ key: sym(k), val: o[k] })));

function raw(contractId: string, topics: xdr.ScVal[], value: xdr.ScVal, over: Partial<RawEvent> = {}): RawEvent {
  return { ledger: 5_382_465, txHash: "6ff00f25", contractId, topic: topics.map(b64), value: b64(value), ...over };
}

describe("normalizeEvent", () => {
  it("decodes pool `drawn` with the agent topic", () => {
    const ev = normalizeEvent(
      raw(POOL, [sym("drawn"), new Address(AGENT).toScVal()], map({ amount: nativeToScVal(5_000_000n, { type: "i128" }), drawn: nativeToScVal(5_000_000n, { type: "i128" }) })),
      { pool: POOL, policy: POLICY },
    );
    expect(ev).toMatchObject({ kind: "drawn", source: "pool", agent: AGENT, ledger: 5_382_465, txHash: "6ff00f25" });
    expect(ev.data).toMatchObject({ amount: "5000000", drawn: "5000000" });
  });
  it("decodes pool `funded` without an agent", () => {
    const ev = normalizeEvent(raw(POOL, [sym("funded")], map({ amount: nativeToScVal(1n, { type: "i128" }), locked: nativeToScVal(2n, { type: "i128" }) })), { pool: POOL, policy: POLICY });
    expect(ev.kind).toBe("funded");
    expect(ev.agent).toBeUndefined();
  });
  it("labels policy events as covenant", () => {
    const ev = normalizeEvent(raw(POLICY, [sym("covenant_installed"), new Address(AGENT).toScVal()], xdr.ScVal.scvVoid()), { pool: POOL, policy: POLICY });
    expect(ev.source).toBe("covenant");
    expect(ev.kind).toBe("covenant_installed");
  });
  it("marks unknown shapes as other without throwing", () => {
    const ev = normalizeEvent(raw("CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAG6", [xdr.ScVal.scvU32(1)], xdr.ScVal.scvVoid()), { pool: POOL, policy: POLICY });
    expect(ev.kind).toBe("other");
    expect(ev.source).toBe("other");
  });
});

import { cursorLedger } from "@/lib/events";
describe("cursorLedger", () => {
  it("extracts the ledger from a toid cursor", () => {
    // toid = ledger << 32 | tx index; this cursor came from testnet at ledger 5382937
    expect(cursorLedger("0023119542666395647-4294967295")).toBe(5382937);
  });
});
