import { describe, expect, it } from "vitest";
import { TransactionBuilder, xdr, Networks, Address } from "@stellar/stellar-sdk";
import { buildOwnerOp, ownerFns } from "@/lib/owner";

const POOL = "CAS7ARNTLTRAD4WLYGIXC5EVMFZBETIQROJ2UWOJGU4QQY5XQT3K2LKJ";
const AGENT = "CAL7PY3A56BEDAN4QKNR5GPKK2UGXRHXG2Y3BX3XH5OHRPWGZS6JCCLZ";

function invoked(op: xdr.Operation) {
  const hf = op.body().invokeHostFunctionOp().hostFunction().invokeContract();
  return { contract: Address.fromScAddress(hf.contractAddress()).toString(), fn: hf.functionName().toString(), args: hf.args() };
}

describe("buildOwnerOp", () => {
  it("fund → pool.fund(amount)", () => {
    const { contract, fn, args } = invoked(buildOwnerOp(POOL, "fund", { amount: "5000000" }));
    expect(contract).toBe(POOL);
    expect(fn).toBe("fund");
    expect(args).toHaveLength(1);
    expect(args[0].switch()).toBe(xdr.ScValType.scvI128());
  });
  it("revoke → pool.revoke(agent, by)", () => {
    const { fn, args } = invoked(buildOwnerOp(POOL, "revoke", { agent: AGENT, by: "GCNN4XIU3KU3QA6B3ENL752Q4J6ZBPOERRT54WV2P2N7GBLHCBNMHBOC" }));
    expect(fn).toBe("revoke");
    expect(args).toHaveLength(2);
  });
  it("create_agent → pool.create_agent(pubkey bytes32, i128, covenant map)", () => {
    const { fn, args } = invoked(
      buildOwnerOp(POOL, "create_agent", {
        agent_pubkey: "0cdb4a5ca7eec8f0d0094dcf9aafb29d85180793ba838bf28663348655013e5d",
        draw_limit: "5000000",
        covenant: { providers: [], provider_per_transfer_cap: "0", provider_total_cap: "0", recipients: [], recipient_per_transfer_cap: "0", recipient_total_cap: "0", calls: [], expiry: 10 },
      }),
    );
    expect(fn).toBe("create_agent");
    expect(args[0].switch()).toBe(xdr.ScValType.scvBytes());
    expect(args[0].bytes()).toHaveLength(32);
    expect(args[1].switch()).toBe(xdr.ScValType.scvI128());
    expect(args[2].switch()).toBe(xdr.ScValType.scvMap());
  });
  it("rejects unknown functions", () => {
    expect(() => buildOwnerOp(POOL, "selfdestruct" as never, {} as never)).toThrow(/unknown/i);
    expect(ownerFns).toContain("withdraw");
  });
  it("op fits in a transaction envelope", () => {
    const op = buildOwnerOp(POOL, "fund", { amount: "1" });
    const tx = new TransactionBuilder({ accountId: () => "GCNN4XIU3KU3QA6B3ENL752Q4J6ZBPOERRT54WV2P2N7GBLHCBNMHBOC", sequenceNumber: () => "1", incrementSequenceNumber() {} }, { fee: "100", networkPassphrase: Networks.TESTNET })
      .addOperation(op).setTimeout(30).build();
    expect(TransactionBuilder.fromXDR(tx.toXDR(), Networks.TESTNET).toXDR()).toBe(tx.toXDR());
  });
});
