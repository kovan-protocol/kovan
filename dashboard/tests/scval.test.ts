import { describe, expect, it } from "vitest";
import { scValToNative, xdr } from "@stellar/stellar-sdk";
import { covenantToScVal } from "@/lib/scval";

const POOL = "CAS7ARNTLTRAD4WLYGIXC5EVMFZBETIQROJ2UWOJGU4QQY5XQT3K2LKJ";
const USDC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const PROV = "GCNN4XIU3KU3QA6B3ENL752Q4J6ZBPOERRT54WV2P2N7GBLHCBNMHBOC";

describe("covenantToScVal", () => {
  const sc = covenantToScVal({
    pool: POOL,
    usdc: USDC,
    providers: [PROV],
    provider_per_transfer_cap: 2_000_000n,
    provider_total_cap: 5_000_000n,
    recipients: [],
    recipient_per_transfer_cap: 0n,
    recipient_total_cap: 0n,
    calls: [{ contract: POOL, fn_name: "ping", amount_arg: 1, amount_cap: 10n }],
    expiry: 5_400_000,
  });

  it("is a map with sorted symbol keys (Soroban struct encoding)", () => {
    expect(sc.switch()).toBe(xdr.ScValType.scvMap());
    const keys = sc.map()!.map((e) => e.key().sym().toString());
    expect(keys).toEqual([...keys].sort());
    expect(keys).toEqual([
      "calls",
      "expiry",
      "pool",
      "provider_per_transfer_cap",
      "provider_total_cap",
      "providers",
      "recipient_per_transfer_cap",
      "recipient_total_cap",
      "recipients",
      "usdc",
    ]);
  });

  it("round-trips through scValToNative with the right types", () => {
    const n = scValToNative(sc);
    expect(n.pool).toBe(POOL);
    expect(n.providers).toEqual([PROV]);
    expect(n.provider_per_transfer_cap).toBe(2_000_000n);
    expect(n.expiry).toBe(5_400_000);
    expect(n.calls[0].fn_name).toBe("ping");
    expect(n.calls[0].amount_arg).toBe(1);
    expect(n.calls[0].amount_cap).toBe(10n);
  });

  it("encodes Option::None as void", () => {
    const sc2 = covenantToScVal({
      pool: POOL, usdc: USDC, providers: [], provider_per_transfer_cap: 0n, provider_total_cap: 0n,
      recipients: [], recipient_per_transfer_cap: 0n, recipient_total_cap: 0n,
      calls: [{ contract: POOL, fn_name: "ping", amount_arg: undefined, amount_cap: 10n }], expiry: 1,
    });
    const calls = sc2.map()!.find((e) => e.key().sym().toString() === "calls")!.val().vec()!;
    const amountArg = calls[0].map()!.find((e) => e.key().sym().toString() === "amount_arg")!.val();
    expect(amountArg.switch()).toBe(xdr.ScValType.scvVoid());
  });
});
