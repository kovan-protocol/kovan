import { describe, expect, it } from "vitest";
import { buildCovenantArgs, type CovenantForm } from "@/lib/covenant-form";

const OWNER = "GCNN4XIU3KU3QA6B3ENL752Q4J6ZBPOERRT54WV2P2N7GBLHCBNMHBOC";
const KEEPER_G = "GAGNWSS4U7XMR4GQBFG47GVPWKOYKGAHSO5IHC7SQZRTJBSVAE7F3KBK";
const KEEPER_HEX = "0cdb4a5ca7eec8f0d0094dcf9aafb29d85180793ba838bf28663348655013e5d";

const base: CovenantForm = {
  agentKey: KEEPER_G,
  drawLimit: "0.5",
  providers: `${OWNER}\n`,
  providerPerTransfer: "0.2",
  providerTotal: "0.5",
  recipients: "",
  recipientPerTransfer: "",
  recipientTotal: "",
  expiryHours: "24",
  calls: [],
};

describe("buildCovenantArgs", () => {
  it("decodes a G address to the raw 32-byte key", () => {
    const r = buildCovenantArgs(base, 1000);
    expect(r.agent_pubkey).toBe(KEEPER_HEX);
  });
  it("accepts a 64-hex key as is", () => {
    expect(buildCovenantArgs({ ...base, agentKey: KEEPER_HEX.toUpperCase() }, 1000).agent_pubkey).toBe(KEEPER_HEX);
  });
  it("converts amounts to base units", () => {
    const r = buildCovenantArgs(base, 1000);
    expect(r.draw_limit).toBe(5_000_000n);
    expect(r.covenant.provider_per_transfer_cap).toBe(2_000_000n);
    expect(r.covenant.provider_total_cap).toBe(5_000_000n);
  });
  it("derives expiry from the latest ledger", () => {
    expect(buildCovenantArgs(base, 5_000_000).covenant.expiry).toBe(5_000_000 + 17_280);
  });
  it("empty recipients give zero caps", () => {
    const r = buildCovenantArgs(base, 1000);
    expect(r.covenant.recipients).toEqual([]);
    expect(r.covenant.recipient_per_transfer_cap).toBe(0n);
    expect(r.covenant.recipient_total_cap).toBe(0n);
  });
  it("rejects an invalid key with a readable message", () => {
    expect(() => buildCovenantArgs({ ...base, agentKey: "nope" }, 1000)).toThrow(/agent key/i);
  });
  it("rejects a provider that is not an address", () => {
    expect(() => buildCovenantArgs({ ...base, providers: "xyz" }, 1000)).toThrow(/provider/i);
  });
  it("maps call rules", () => {
    const r = buildCovenantArgs(
      { ...base, calls: [{ contract: "CAS7ARNTLTRAD4WLYGIXC5EVMFZBETIQROJ2UWOJGU4QQY5XQT3K2LKJ", fnName: "ping", amountArg: "1", amountCap: "0.001" }] },
      1000,
    );
    expect(r.covenant.calls).toEqual([
      { contract: "CAS7ARNTLTRAD4WLYGIXC5EVMFZBETIQROJ2UWOJGU4QQY5XQT3K2LKJ", fn_name: "ping", amount_arg: 1, amount_cap: 10_000n },
    ]);
  });
});
