import { describe, expect, it, vi } from "vitest";
import { Account, Address, Contract, Keypair, nativeToScVal, Networks, TransactionBuilder, xdr } from "@stellar/stellar-sdk";
import { buildAgentOp, buildCreatePoolOp, buildOwnerOp, bytes32Val, i128Val, jsonSafe, keypairTransactionSigner, ownerFns, prepareOperation, signPrepared, submitSigned } from "../src/index.js";
import { buildYieldOp } from "../src/experimental.js";
import { AGENT, agentKey, config, covenant, entry, owner, POLICY, POOL, poolInfo, setup, simulation, TOKEN, VERIFIER } from "./fixtures.js";

describe("pure operations and data", () => {
  it.each(["0", "-1", "0.1", "1e7", "", (1n << 127n).toString()])("rejects invalid funding amount %s", (amount) => {
    expect(() => buildOwnerOp(POOL, "fund", { amount })).toThrow();
    expect(() => buildAgentOp(POOL, TOKEN, "draw", { agent: AGENT, amount })).toThrow();
  });
  it("preserves large integer amounts and rejects JavaScript numbers", () => {
    expect(i128Val("9007199254740993").toXDR()).toBeDefined();
    expect(() => i128Val(1 as never)).toThrow(/integer/);
    expect(() => bytes32Val("a".repeat(64) + "xx")).toThrow();
  });
  it("encodes deployment constructor inputs and rejects malformed salt/hash", () => {
    const args = { owner: owner.publicKey(), ...config, salt: Buffer.alloc(32, 1) };
    const op = buildCreatePoolOp(args).body().invokeHostFunctionOp().hostFunction().createContractV2();
    expect(op.constructorArgs()).toHaveLength(5);
    expect(Address.fromScVal(op.constructorArgs()[0]).toString()).toBe(owner.publicKey());
    expect(() => buildCreatePoolOp({ ...args, salt: Buffer.alloc(31) })).toThrow();
    expect(() => buildCreatePoolOp({ ...args, poolWasmHash: "abc" })).toThrow();
  });
  it("does not expose yield as a stable owner operation", () => {
    expect(ownerFns).not.toContain("invest");
    expect(() => buildOwnerOp(POOL, "invest" as never, {} as never)).toThrow(/unknown/);
    expect(buildYieldOp(POOL, "invest", { amount: "10", min_shares: "1", valid_until: 100 })).toBeDefined();
  });
  it("serializes bigint and bytes without losing precision", () => {
    expect(jsonSafe({ n: 9007199254740993n, bytes: new Uint8Array([0, 255]), a: [1n] })).toEqual({ n: "9007199254740993", bytes: "00ff", a: ["1"] });
  });
});

describe("preparing and signing", () => {
  it("prepares an owner transaction without signing or submitting", async () => {
    const { client, rpc } = setup();
    const prepared = await client.prepareCreatePool(owner.publicKey());
    expect(prepared.source).toBe(owner.publicKey());
    expect(prepared.networkPassphrase).toBe(Networks.TESTNET);
    expect(rpc.sendTransaction).not.toHaveBeenCalled();
    expect(TransactionBuilder.fromXDR(prepared.xdr, Networks.TESTNET).signatures).toHaveLength(0);
  });
  it("refuses a mismatched RPC network before simulation", async () => {
    const { client, rpc } = setup();
    rpc.getNetwork.mockResolvedValue({ passphrase: Networks.PUBLIC });
    await expect(client.prepareCreatePool(owner.publicKey())).rejects.toThrow(/network/);
    expect(rpc.simulateTransaction).not.toHaveBeenCalled();
  });
  it("refuses untrusted pool code before asking an owner to sign", async () => {
    const { pool, rpc } = setup();
    rpc.getContractWasmByContractId.mockResolvedValue(Buffer.from("changed"));
    await expect(pool.prepareOwner("fund", { amount: "1" }, owner.publicKey())).rejects.toThrow(/trusted/);
  });
  it("verifies pool owner and exact settlement asset", async () => {
    const { pool } = setup();
    vi.spyOn(pool, "getPool").mockResolvedValueOnce({ ...poolInfo, usdc: POLICY }).mockResolvedValueOnce(poolInfo);
    await expect(pool.prepareOwner("fund", { amount: "1" }, owner.publicKey())).rejects.toThrow(/asset/);
    await expect(pool.prepareOwner("fund", { amount: "1" }, Keypair.random().publicKey())).rejects.toThrow(/original pool owner/);
  });
  it("checks closure capability rather than assuming accounting v2 is enough", async () => {
    const { pool } = setup();
    vi.spyOn(pool, "getPool").mockResolvedValue({ ...poolInfo, closed: undefined });
    await expect(pool.prepareOwner("close_pool", {}, owner.publicKey())).rejects.toThrow(/legacy/);
  });
  it("rejects a prepared transaction from another network before calling a wallet", async () => {
    const { client } = setup();
    const prepared = await client.prepareCreatePool(owner.publicKey());
    const signer = vi.fn();
    await expect(client.signAndSend({ ...prepared, networkPassphrase: Networks.PUBLIC }, signer)).rejects.toThrow(/another network/);
    expect(signer).not.toHaveBeenCalled();
  });
  it("detects tampered prepared metadata before calling a signer", async () => {
    const { client } = setup();
    const prepared = await client.prepareCreatePool(owner.publicKey());
    const signer = vi.fn();
    await expect(signPrepared({ ...prepared, hash: "0".repeat(64) }, signer)).rejects.toThrow(/modified/);
    expect(signer).not.toHaveBeenCalled();
  });
  it("checks the configured covenant policy when reading an agent signer", async () => {
    const { client, pool } = setup();
    vi.spyOn(client, "read").mockResolvedValue({ signers: [["External", VERIFIER, agentKey.rawPublicKey()]], policies: [TOKEN] });
    await expect(pool.getAgentSigner(AGENT)).rejects.toThrow(/policy/);
  });
  it.each(["legacy", "v2"])("refuses third-party %s authorization on owner preparation", async (kind) => {
    const { rpc } = setup();
    rpc.simulateTransaction.mockResolvedValue(simulation(undefined, [entry(undefined, kind)]));
    await expect(prepareOperation({ rpc, networkPassphrase: Networks.TESTNET }, { source: owner.publicKey(), operation: buildOwnerOp(POOL, "fund", { amount: "1" }) })).rejects.toThrow(/needs a signature/);
  });
  it("blocks fees above the explicit cap", async () => {
    const { rpc } = setup();
    const sim = simulation();
    sim.transactionData.setResourceFee("100000000");
    rpc.simulateTransaction.mockResolvedValue({ ...sim, minResourceFee: "100000000" });
    await expect(prepareOperation({ rpc, networkPassphrase: Networks.TESTNET }, { source: owner.publicKey(), operation: buildOwnerOp(POOL, "fund", { amount: "1" }) })).rejects.toThrow(/fee/);
  });
  it("preserves wallet rejection, does not submit, and detects a modified signed body", async () => {
    const { client, rpc } = setup();
    const prepared = await client.prepareCreatePool(owner.publicKey());
    await expect(client.signAndSend(prepared, async () => { throw new Error("User rejected"); })).rejects.toThrow("User rejected");
    expect(rpc.sendTransaction).not.toHaveBeenCalled();
    await expect(signPrepared(prepared, async () => {
      const tx = new TransactionBuilder(new Account(owner.publicKey(), "4"), { networkPassphrase: Networks.TESTNET, fee: "100" }).addOperation(buildOwnerOp(POOL, "fund", { amount: "9" })).setTimeout(120).build();
      tx.sign(owner); return tx.toXDR();
    })).rejects.toThrow(/changed/);
    await expect(signPrepared(prepared, async (xdr) => xdr)).rejects.toThrow(/unsigned/);
    expect(await signPrepared(prepared, keypairTransactionSigner(owner))).toBeTypeOf("string");
  });
});

describe("agent execution guards", () => {
  function ready() {
    const result = setup();
    vi.spyOn(result.pool, "getPool").mockResolvedValue(poolInfo);
    vi.spyOn(result.pool, "getAgent").mockResolvedValue({ covenant: { ...covenant, pool: POOL, usdc: TOKEN }, state: null } as never);
    vi.spyOn(result.pool, "getAgentSigner").mockResolvedValue({ verifier: VERIFIER, pubkeyHex: agentKey.rawPublicKey().toString("hex") });
    const sign = vi.fn((digest: Uint8Array) => agentKey.sign(Buffer.from(digest)));
    const options = { source: owner.publicKey(), signer: { publicKey: agentKey.rawPublicKey().toString("hex"), sign } };
    const op = buildAgentOp(POOL, TOKEN, "draw", { agent: AGENT, amount: "1" });
    const invocation = new xdr.SorobanAuthorizedInvocation({ function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(op.body().invokeHostFunctionOp().hostFunction().invokeContract()), subInvocations: [] });
    result.rpc.simulateTransaction.mockResolvedValueOnce(simulation(undefined, [entry(invocation, "v2")])).mockResolvedValue(simulation());
    return { ...result, sign, options, invocation };
  }
  it("re-simulates with enforce after agent signing and leaves fee payer unsigned", async () => {
    const { pool, rpc, options, sign } = ready();
    const prepared = await pool.prepareAgent("draw", { agent: AGENT, amount: "1" }, options);
    expect(sign).toHaveBeenCalledTimes(1);
    expect(rpc.simulateTransaction.mock.calls[1][2]).toBe("enforce");
    expect(TransactionBuilder.fromXDR(prepared.xdr, Networks.TESTNET).signatures).toHaveLength(0);
    expect(rpc.sendTransaction).not.toHaveBeenCalled();
  });
  it("rejects a signer mismatch before invoking the signing callback", async () => {
    const { pool, options, sign } = ready();
    options.signer.publicKey = "a".repeat(64);
    await expect(pool.prepareAgent("draw", { agent: AGENT, amount: "1" }, options)).rejects.toThrow(/on-chain/);
    expect(sign).not.toHaveBeenCalled();
  });
  it("rejects an agent belonging to a different pool before signing", async () => {
    const { pool, options, sign } = ready();
    vi.mocked(pool.getAgent).mockResolvedValue({ covenant: { ...covenant, pool: POLICY, usdc: TOKEN } } as never);
    await expect(pool.prepareAgent("draw", { agent: AGENT, amount: "1" }, options)).rejects.toThrow(/not bound/);
    expect(sign).not.toHaveBeenCalled();
  });
  it("refuses unexpected source-account authorization instead of lending the fee payer's signature", async () => {
    const { pool, rpc, options, sign, invocation } = ready();
    rpc.simulateTransaction.mockReset().mockResolvedValue(simulation(undefined, [entry(invocation, "source")]));
    await expect(pool.prepareAgent("draw", { agent: AGENT, amount: "1" }, options)).rejects.toThrow(/unsupported/);
    expect(sign).not.toHaveBeenCalled();
  });
  it("rejects an injected authorization target", async () => {
    const { pool, rpc, options, sign } = ready();
    rpc.simulateTransaction.mockReset().mockResolvedValue(simulation(undefined, [entry()]));
    await expect(pool.prepareAgent("draw", { agent: AGENT, amount: "2" }, options)).rejects.toThrow(/unexpected authorization/);
    expect(sign).not.toHaveBeenCalled();
  });
  it("rejects nested invocation injection even under an otherwise valid root", async () => {
    const { pool, rpc, options, sign, invocation } = ready();
    invocation.subInvocations([entry().rootInvocation()]);
    rpc.simulateTransaction.mockReset().mockResolvedValue(simulation(undefined, [entry(invocation)]));
    await expect(pool.prepareAgent("draw", { agent: AGENT, amount: "1" }, options)).rejects.toThrow(/unexpected authorization/);
    expect(sign).not.toHaveBeenCalled();
  });
  it("surfaces covenant refusal before fee payer signature or submission", async () => {
    const { pool, rpc, options } = ready();
    rpc.simulateTransaction.mockReset().mockResolvedValueOnce(simulation(undefined, [entry()])).mockResolvedValueOnce({ error: "Error(Contract, #3906)", latestLedger: 100 });
    await expect(pool.prepareAgent("draw", { agent: AGENT, amount: "1" }, options)).rejects.toThrow(/PerTransferCapExceeded/);
    expect(rpc.sendTransaction).not.toHaveBeenCalled();
  });
});

describe("submission outcomes", () => {
  async function tx() { const { client, rpc } = setup(); return { rpc, transport: { rpc, networkPassphrase: Networks.TESTNET }, xdr: await signPrepared(await client.prepareCreatePool(owner.publicKey()), keypairTransactionSigner(owner)) }; }
  it("sends once, polls pending, and decodes the committed return value", async () => {
    const { rpc, transport, xdr } = await tx();
    rpc.getTransaction.mockResolvedValueOnce({ status: "NOT_FOUND" }).mockResolvedValueOnce({ status: "SUCCESS", returnValue: nativeToScVal(5n, { type: "i128" }) });
    expect(await submitSigned(transport, xdr, { intervalMs: 0, attempts: 2 })).toMatchObject({ status: "SUCCESS", returnValue: 5n });
    expect(rpc.sendTransaction).toHaveBeenCalledTimes(1);
  });
  it("preserves the transaction hash on timeout and never resubmits", async () => {
    const { rpc, transport, xdr } = await tx();
    rpc.getTransaction.mockResolvedValue({ status: "NOT_FOUND" });
    expect(await submitSigned(transport, xdr, { intervalMs: 0, attempts: 2 })).toMatchObject({ status: "NOT_FOUND", hash: "b".repeat(64) });
    expect(rpc.sendTransaction).toHaveBeenCalledTimes(1);
  });
  it("reports ambiguous submission transport failure with the locally computed hash", async () => {
    const { rpc, transport, xdr } = await tx();
    rpc.sendTransaction.mockRejectedValue(new Error("connection lost"));
    expect(await submitSigned(transport, xdr)).toMatchObject({ status: "NOT_FOUND", hash: TransactionBuilder.fromXDR(xdr, Networks.TESTNET).hash().toString("hex") });
    expect(rpc.sendTransaction).toHaveBeenCalledTimes(1);
  });
  it("returns terminal failure without claiming success", async () => {
    const { rpc, transport, xdr } = await tx();
    rpc.getTransaction.mockResolvedValue({ status: "FAILED" });
    expect(await submitSigned(transport, xdr, { intervalMs: 0, attempts: 1 })).toMatchObject({ status: "FAILED" });
  });
});
