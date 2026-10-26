import { beforeEach, describe, expect, it, vi } from "vitest";
import { Account, Address, Contract, Keypair, Networks, SorobanDataBuilder, StrKey, TransactionBuilder, xdr } from "@stellar/stellar-sdk";
import { buildOwnerOp as sdkOwnerOp, covenantToScVal as sdkCovenant, signAgentEntry as sdkSign } from "@kovan-protocol/sdk";
import { buildOwnerOp } from "@/lib/owner";
import { covenantToScVal } from "@/lib/scval";
import { signAgentEntry } from "@/lib/authpayload";

const mocks = vi.hoisted(() => ({ rpc: { getAccount: vi.fn(), getNetwork: vi.fn(), simulateTransaction: vi.fn(), sendTransaction: vi.fn() }, assertPool: vi.fn(), readPool: vi.fn(), vault: vi.fn(), id: {} as Record<string, string> }));
vi.mock("@/lib/stellar", () => ({
  NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
  rpcServer: () => mocks.rpc, ids: () => mocks.id, assertKovanPool: mocks.assertPool,
  rejectCrossSite: () => null,
}));
vi.mock("@/lib/contracts", () => ({ readPool: mocks.readPool, readYield: vi.fn() }));
vi.mock("@/lib/yield", () => ({ requireListedVault: mocks.vault }));
import { POST } from "@/app/api/tx/build/route";

const owner = Keypair.random();
const pool = StrKey.encodeContract(Buffer.alloc(32, 1));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.id = { pool, usdc: pool, policy: pool, verifier: pool, poolWasmHash: "a".repeat(64), accountWasmHash: "b".repeat(64) };
  mocks.rpc.getNetwork.mockResolvedValue({ passphrase: Networks.TESTNET });
  mocks.rpc.getAccount.mockResolvedValue(new Account(owner.publicKey(), "1"));
  mocks.rpc.simulateTransaction.mockResolvedValue({ _parsed: true, latestLedger: 100, minResourceFee: "0", transactionData: new SorobanDataBuilder(), result: { retval: xdr.ScVal.scvVoid(), auth: [] }, events: [] });
});
const post = (fn = "fund", args: object = { amount: "1000000" }) => POST(new Request("http://localhost/api/tx/build", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fn, args, source: owner.publicKey() }) }));

describe("dashboard consumes installed SDK", () => {
  it("uses the same serializers/signers and produces identical stable operations", () => {
    expect(covenantToScVal).toBe(sdkCovenant);
    expect(signAgentEntry).toBe(sdkSign);
    expect(buildOwnerOp(pool, "fund", { amount: "1" }).toXDR()).toEqual(sdkOwnerOp(pool, "fund", { amount: "1" }).toXDR());
  });
  it("builds an unsigned owner envelope through SDK preparation without submitting", async () => {
    const response = await post();
    expect(response.status).toBe(200);
    const { xdr: envelope } = await response.json();
    expect(TransactionBuilder.fromXDR(envelope, Networks.TESTNET).signatures).toHaveLength(0);
    expect(mocks.assertPool).toHaveBeenCalledWith(pool);
    expect(mocks.rpc.getNetwork).toHaveBeenCalledOnce();
    expect(mocks.rpc.sendTransaction).not.toHaveBeenCalled();
  });
  it("surfaces network mismatch before wallet signing", async () => {
    mocks.rpc.getNetwork.mockResolvedValue({ passphrase: Networks.PUBLIC });
    const response = await post();
    expect(response.status).toBe(422);
    expect((await response.json()).error).toMatch(/network/);
    expect(mocks.rpc.simulateTransaction).not.toHaveBeenCalled();
  });
  it("catches AddressV2 third-party requirements rather than asking the wrong owner to sign", async () => {
    const fn = new Contract(pool).call("fund", xdr.ScVal.scvVoid()).body().invokeHostFunctionOp().hostFunction().invokeContract();
    const auth = new xdr.SorobanAuthorizationEntry({
      credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(new xdr.SorobanAddressCredentials({ address: new Address(Keypair.random().publicKey()).toScAddress(), nonce: xdr.Int64.fromString("1"), signatureExpirationLedger: 0, signature: xdr.ScVal.scvVoid() })),
      rootInvocation: new xdr.SorobanAuthorizedInvocation({ function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(fn), subInvocations: [] }),
    });
    mocks.rpc.simulateTransaction.mockResolvedValue({ _parsed: true, latestLedger: 100, minResourceFee: "0", transactionData: new SorobanDataBuilder(), result: { retval: xdr.ScVal.scvVoid(), auth: [auth] }, events: [] });
    const response = await post();
    expect(response.status).toBe(422);
    expect((await response.json()).error).toMatch(/needs a signature/);
  });
  it("keeps the experimental yield gate before SDK preparation", async () => {
    mocks.readPool.mockResolvedValue({ accounting_version: 2, owner: owner.publicKey() });
    const response = await post("configure_yield", { vault: pool, wasm_hash: "c".repeat(64) });
    expect(response.status).toBe(422);
    expect(mocks.vault).not.toHaveBeenCalled();
    expect(mocks.rpc.simulateTransaction).not.toHaveBeenCalled();
  });
});
