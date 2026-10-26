import { describe, expect, it, vi } from "vitest";
import { buildAuthorizationEntryPreimage, hash, Networks, scValToNative, TransactionBuilder, xdr } from "@stellar/stellar-sdk";
import { agentCredentials, authDigest, buildAgentOp, buildOwnerOp, mandateToScVal, paymentBindingToScVal, paymentIdForRequest, paymentPayloadHash, signAgentAuthorization, type MandateInput, type MandateState, type PaymentBinding } from "../src/index.js";
import { AGENT, agentKey, covenant, entry, owner, POOL, poolInfo, setup, simulation, TOKEN, VERIFIER } from "./fixtures.js";

const payment: PaymentBinding = { mandateId: "01".repeat(32), paymentId: "03".repeat(32), reference: "04".repeat(32), validUntil: 100 };
const grant: MandateInput = { id: payment.mandateId, intent_hash: "02".repeat(32), expiry: 1000, scope: { kind: "budget", payees: [owner.publicKey()], per_payment_cap: "2000000", total_cap: "5000000" } };
const state = (): MandateState => ({ params: scValToNative(mandateToScVal(grant)), spent: 0n, payments: 0, revoked: false });

describe("mandate ABI and signing", () => {
  it("matches the Rust domain-separated mandate digest vector", () => {
    expect(authDigest("CAS7ARNTLTRAD4WLYGIXC5EVMFZBETIQROJ2UWOJGU4QQY5XQT3K2LKJ", paymentPayloadHash(Buffer.alloc(32, 7), payment), [0]).toString("hex"))
      .toBe("46c9a09bc878f9d0461eebf5d889d29c570f421379ba76ec8ab1b16724090628");
  });
  it("encodes both budget and exact grants without rounding", () => {
    expect(scValToNative(mandateToScVal(grant)).scope).toEqual(["Budget", { payees: [owner.publicKey()], per_payment_cap: 2000000n, total_cap: 5000000n }]);
    const exact = mandateToScVal({ ...grant, scope: { kind: "exact", asset: TOKEN, payee: owner.publicKey(), amount: "9007199254740993", reference: payment.reference } });
    expect(scValToNative(exact).scope[1].amount).toBe(9007199254740993n);
  });
  it("builds owner grants and revocations, never grants from the agent key", () => {
    const create = buildOwnerOp(POOL, "create_mandate", { agent: AGENT, params: grant }).body().invokeHostFunctionOp().hostFunction().invokeContract();
    expect(create.functionName().toString()).toBe("create_mandate");
    expect(scValToNative(create.args()[1])).toEqual(scValToNative(mandateToScVal(grant)));
    expect(buildOwnerOp(POOL, "revoke_mandate", { agent: AGENT, id: payment.mandateId })).toBeDefined();
  });
  it.each([
    { ...grant, id: "0".repeat(64) }, { ...grant, intent_hash: "bad" }, { ...grant, expiry: -1 },
    { ...grant, scope: { kind: "budget", payees: [], per_payment_cap: "1", total_cap: "2" } },
    { ...grant, scope: { kind: "budget", payees: [owner.publicKey(), owner.publicKey()], per_payment_cap: "1", total_cap: "2" } },
    { ...grant, scope: { kind: "budget", payees: [owner.publicKey()], per_payment_cap: "3", total_cap: "2" } },
    { ...grant, scope: { kind: "budget", payees: [owner.publicKey()], per_payment_cap: "0", total_cap: "2" } },
  ])("rejects malformed mandate %j", value => expect(() => mandateToScVal(value as MandateInput)).toThrow());
  it("derives a stable on-chain payment ID independent of nonce and mandate", () => {
    expect(paymentIdForRequest("request_1234567890")).toMatch(/^[a-f0-9]{64}$/);
    expect(paymentIdForRequest("request_1234567890")).toBe(paymentIdForRequest("request_1234567890"));
    expect(paymentIdForRequest("request_1234567891")).not.toBe(paymentIdForRequest("request_1234567890"));
    expect(() => paymentIdForRequest("short")).toThrow();
  });
  it.each(["legacy", "v2"])("signs mandate-bound %s credentials and exposes reviewed context to the signer", async kind => {
    const sign = vi.fn((digest: Uint8Array) => agentKey.sign(Buffer.from(digest)));
    const signed = await signAgentAuthorization(entry(undefined, kind), { agent: AGENT, verifier: VERIFIER, networkPassphrase: Networks.TESTNET, expirationLedger: 99, signer: { publicKey: agentKey.rawPublicKey().toString("hex"), sign }, payment });
    const decoded = scValToNative(agentCredentials(signed).signature());
    expect(decoded.version).toBe(1);
    expect(decoded.payment).toEqual(scValToNative(paymentBindingToScVal(payment)));
    const host = hash(buildAuthorizationEntryPreimage(signed, 99, Networks.TESTNET).toXDR());
    const digest = authDigest(AGENT, paymentPayloadHash(host, payment), [0]);
    expect(sign.mock.calls[0][0]).toEqual(digest);
    const sig = agentCredentials(signed).signature().map()![0].val().map()![1].val().map()![0].val().bytes();
    expect(agentKey.verify(digest, Buffer.from(sig))).toBe(true);
    expect(agentKey.verify(authDigest(AGENT, host, [0]), Buffer.from(sig))).toBe(false);
    for (const changed of [{ ...payment, reference: "08".repeat(32) }, { ...payment, mandateId: "08".repeat(32) }, { ...payment, paymentId: "08".repeat(32) }, { ...payment, validUntil: 98 }]) {
      expect(agentKey.verify(authDigest(AGENT, paymentPayloadHash(host, changed), [0]), Buffer.from(sig))).toBe(false);
    }
  });
});

function ready() {
  const result = setup();
  vi.spyOn(result.pool, "getPool").mockResolvedValue(poolInfo);
  vi.spyOn(result.pool, "getAgent").mockResolvedValue({ covenant: { ...covenant, pool: POOL, usdc: TOKEN }, state: null } as never);
  vi.spyOn(result.pool, "getAgentSigner").mockResolvedValue({ verifier: VERIFIER, pubkeyHex: agentKey.rawPublicKey().toString("hex") });
  vi.spyOn(result.pool, "requireMandates").mockResolvedValue();
  vi.spyOn(result.pool, "getMandate").mockResolvedValue(state());
  vi.spyOn(result.pool, "getPayment").mockResolvedValue(null);
  const sign = vi.fn((digest: Uint8Array) => agentKey.sign(Buffer.from(digest)));
  const options = { source: owner.publicKey(), timeoutSeconds: 30, signer: { publicKey: agentKey.rawPublicKey().toString("hex"), sign } };
  const request = { agent: AGENT, to: owner.publicKey(), amount: "100000", payment: { ...payment, validUntil: undefined } };
  const operation = buildAgentOp(POOL, TOKEN, "pay", request);
  const root = new xdr.SorobanAuthorizedInvocation({ function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(operation.body().invokeHostFunctionOp().hostFunction().invokeContract()), subInvocations: [] });
  result.rpc.simulateTransaction.mockResolvedValueOnce(simulation(undefined, [entry(root, "v2")])).mockResolvedValue(simulation());
  return { ...result, request, options, sign };
}

describe("SDK mandate preparation", () => {
  it("keeps x402's one direct transfer, binds metadata, and re-simulates enforcement", async () => {
    const { pool, rpc, request, options } = ready();
    const prepared = await pool.prepareAgent("pay", request, options);
    const tx = TransactionBuilder.fromXDR(prepared.xdr, Networks.TESTNET);
    expect(tx.operations).toHaveLength(1);
    const operation = tx.operations[0];
    if (operation.type !== "invokeHostFunction") throw new Error("wrong operation");
    expect(operation.func.invokeContract().functionName().toString()).toBe("transfer");
    expect(operation.auth![0].rootInvocation().subInvocations()).toHaveLength(0);
    expect(agentCredentials(operation.auth![0]).signatureExpirationLedger()).toBe(106);
    expect(scValToNative(agentCredentials(operation.auth![0]).signature()).payment.valid_until).toBe(107);
    expect(pool.requireMandates).toHaveBeenCalledWith(AGENT);
    expect(rpc.simulateTransaction.mock.calls[1][2]).toBe("enforce");
    expect(tx.signatures).toHaveLength(0);
    expect(rpc.sendTransaction).not.toHaveBeenCalled();
  });
  it("never signs an already-consumed payment ID", async () => {
    const { pool, request, options, sign } = ready();
    vi.mocked(pool.getPayment).mockResolvedValue({} as never);
    await expect(pool.prepareAgent("pay", request, options)).rejects.toThrow(/PaymentConsumed/);
    expect(sign).not.toHaveBeenCalled();
  });
  it.each([null, { ...state(), revoked: true }])("refuses unavailable/revoked mandate before signing", async mandate => {
    const { pool, request, options, sign } = ready();
    vi.mocked(pool.getMandate).mockResolvedValue(mandate);
    await expect(pool.prepareAgent("pay", request, options)).rejects.toThrow(/missing or revoked/);
    expect(sign).not.toHaveBeenCalled();
  });
  it("does not silently downgrade unsupported mandate payments to legacy signing", async () => {
    const { pool, request, options, sign } = ready();
    vi.mocked(pool.requireMandates).mockRejectedValue(new Error("unsupported"));
    await expect(pool.prepareAgent("pay", request, options)).rejects.toThrow(/unsupported/);
    expect(sign).not.toHaveBeenCalled();
  });
  it("clips auth lifetime to the covenant and mandate's exclusive expiry", async () => {
    const { pool, rpc, request, options } = ready();
    const mandate = state(); mandate.params.expiry = 105;
    vi.mocked(pool.getMandate).mockResolvedValue(mandate);
    await pool.prepareAgent("pay", request, options);
    expect(agentCredentials(rpc.simulateTransaction.mock.calls[1][0].operations[0].auth[0]).signatureExpirationLedger()).toBe(104);
  });
  it.each([100, 1001, Infinity, -1])("rejects invalid deadline %s before signing", async validUntil => {
    const { pool, request, options, sign } = ready();
    await expect(pool.prepareAgent("pay", { ...request, payment: { ...request.payment, validUntil } }, options)).rejects.toThrow();
    expect(sign).not.toHaveBeenCalled();
  });
  it("does not attach payment metadata to recovery", async () => {
    const { pool, request, options, sign } = ready();
    await expect(pool.prepareAgent("return", request, options)).rejects.toThrow(/recovery/);
    expect(sign).not.toHaveBeenCalled();
  });
  it("requires actual account code as well as a version response", async () => {
    const { client, pool } = setup();
    vi.spyOn(client, "read").mockResolvedValue(1);
    await expect(pool.requireMandates(AGENT)).rejects.toThrow(/configured account code/);
  });
});
