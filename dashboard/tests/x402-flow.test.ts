import { beforeEach, describe, expect, it, vi } from "vitest";
import { Account, Address, Contract, Keypair, nativeToScVal, Networks, Operation, StrKey, TransactionBuilder, xdr } from "@stellar/stellar-sdk";
import { KovanError, paymentIdForRequest } from "@kovan-protocol/sdk";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), prepare: vi.fn(), pool: vi.fn(), key: vi.fn(), fee: vi.fn(), rpc: { getNetwork: vi.fn(), getTransaction: vi.fn() }, ids: {} as Record<string, string> }));
vi.mock("@/lib/x402-http", () => ({ fetchPaymentResource: mocks.fetch }));
vi.mock("@/lib/kovan", () => ({ kovanClient: () => ({ pool: mocks.pool }) }));
vi.mock("@/lib/agent", () => ({ resolveAgentSecret: mocks.key, feePayerKeypair: mocks.fee }));
vi.mock("@/lib/stellar", () => ({ ids: (pool?: string) => ({ ...mocks.ids, ...(pool ? { pool } : {}) }), NETWORK_PASSPHRASE: "Test SDF Network ; September 2015", rpcServer: () => mocks.rpc, withRetry: (fn: () => unknown) => fn() }));

import { assertSettlementMatches, discoverTerms, payEndpoint } from "@/lib/agent-x402";
import { paymentQuoteId } from "@/lib/x402";

const agent = StrKey.encodeContract(Buffer.alloc(32, 1));
const token = StrKey.encodeContract(Buffer.alloc(32, 2));
const pool = StrKey.encodeContract(Buffer.alloc(32, 3));
const verifier = StrKey.encodeContract(Buffer.alloc(32, 4));
const key = Keypair.random();
const fee = Keypair.random();
const payee = Keypair.random().publicKey();
const url = "https://example.com/paid?q=1";
const requirement = { scheme: "exact", network: "stellar:testnet", amount: "100000", asset: token, payTo: payee, maxTimeoutSeconds: 300, extra: { areFeesSponsored: true } };
const pr = { x402Version: 2, resource: { url }, accepts: [requirement] };
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64");
const options = { pool, quoteId: paymentQuoteId(url, requirement) };

function transfer(amount = "100000", nonce = "5") {
  const func = new Contract(token).call("transfer", new Address(agent).toScVal(), new Address(payee).toScVal(), nativeToScVal(BigInt(amount), { type: "i128" })).body().invokeHostFunctionOp().hostFunction();
  const auth = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(new xdr.SorobanAddressCredentials({ address: new Address(agent).toScAddress(), nonce: xdr.Int64.fromString(nonce), signatureExpirationLedger: 160, signature: xdr.ScVal.scvBytes(Buffer.alloc(64, 1)) })),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({ function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(func.invokeContract()), subInvocations: [] }),
  });
  return Operation.invokeHostFunction({ func, auth: [auth] });
}
function transaction(source = fee.publicKey(), operation = transfer()) {
  return new TransactionBuilder(new Account(source, "1"), { fee: "10000", networkPassphrase: Networks.TESTNET }).addOperation(operation).setTimeout(300).build();
}
const prepared = transaction();
const settled = transaction(Keypair.random().publicKey());
const receipt = { success: true, network: "stellar:testnet", payer: agent, transaction: settled.hash().toString("hex") };
function paidResponse(body: object = receipt, status = 200) { return { status, body: "resource", headers: new Headers({ "payment-response": encode(body), "content-type": "text/plain" }) }; }
beforeEach(() => {
  vi.resetAllMocks();
  mocks.ids = { pool, usdc: token, verifier };
  mocks.fetch.mockResolvedValueOnce({ status: 402, headers: new Headers({ "payment-required": encode(pr) }), body: "" }).mockResolvedValue(paidResponse());
  mocks.key.mockResolvedValue(key.secret());
  mocks.fee.mockResolvedValue(fee);
  mocks.pool.mockReturnValue({ prepareAgent: mocks.prepare });
  mocks.prepare.mockResolvedValue({ xdr: prepared.toXDR() });
  mocks.rpc.getNetwork.mockResolvedValue({ passphrase: Networks.TESTNET });
  mocks.rpc.getTransaction.mockResolvedValue({ status: "SUCCESS", envelopeXdr: settled.toEnvelope() });
});

describe("x402 payment boundary", () => {
  it("binds the reviewed quote and persistent request ID into the on-chain mandate authorization", async () => {
    const mandateId = "1".repeat(64), requestId = "request_1234567890";
    expect(await payEndpoint(agent, url, { ...options, mandateId, requestId })).toMatchObject({ ok: true });
    expect(mocks.prepare).toHaveBeenCalledWith("pay", expect.objectContaining({ payment: { mandateId, paymentId: paymentIdForRequest(requestId), reference: options.quoteId } }), expect.any(Object));
    const payload = JSON.parse(Buffer.from(mocks.fetch.mock.calls[1][1]["payment-signature"], "base64").toString());
    expect(payload.accepted).toEqual(requirement); // No nonstandard x402 extensions or payment wrapper.
  });
  it("never silently drops a mandate if the request ID is missing", async () => {
    expect(await payEndpoint(agent, url, { ...options, mandateId: "1".repeat(64) })).toMatchObject({ ok: false, paymentStatus: "not_sent", stage: "guard" });
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it("discovers without accessing keys or signing", async () => {
    expect(await discoverTerms(url)).toMatchObject({ quoteId: options.quoteId, amount: "100000" });
    expect(mocks.key).not.toHaveBeenCalled();
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it("uses the selected pool, SDK authorization and exact timeout, then confirms the matching transaction", async () => {
    const result = await payEndpoint(agent, url, options);
    expect(result).toMatchObject({ ok: true, paymentStatus: "confirmed", txHash: receipt.transaction });
    expect(mocks.pool).toHaveBeenCalledWith(pool);
    expect(mocks.prepare).toHaveBeenCalledWith("pay", { agent, to: payee, amount: "100000" }, expect.objectContaining({ timeoutSeconds: 300, source: fee.publicKey() }));
    const payload = JSON.parse(Buffer.from(mocks.fetch.mock.calls[1][1]["payment-signature"], "base64").toString());
    expect(TransactionBuilder.fromXDR(payload.payload.transaction, Networks.TESTNET).signatures).toHaveLength(0);
    expect(mocks.rpc.getTransaction).toHaveBeenCalledWith(receipt.transaction);
  });
  it("refuses changed terms before any signing", async () => {
    expect(await payEndpoint(agent, url, { ...options, quoteId: "0".repeat(64) })).toMatchObject({ ok: false, paymentStatus: "not_sent", stage: "terms" });
    expect(mocks.key).not.toHaveBeenCalled();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it.each([{ resource: { url: "https://different.example/paid" } }, { accepts: [{ ...requirement, asset: pool }] }, { accepts: [{ ...requirement, network: "stellar:pubnet" }] }])("refuses unsupported terms %j", async (change) => {
    mocks.fetch.mockReset().mockResolvedValue({ status: 402, headers: new Headers({ "payment-required": encode({ ...pr, ...change }) }) });
    expect(await payEndpoint(agent, url, options)).toMatchObject({ ok: false, paymentStatus: "not_sent" });
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it("never sends a payment to the resource when the SDK refuses the covenant", async () => {
    mocks.prepare.mockRejectedValue(new KovanError("simulate", "PerTransferCapExceeded"));
    expect(await payEndpoint(agent, url, options)).toMatchObject({ ok: false, stage: "simulate", paymentStatus: "not_sent" });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it.each([{}, { ...receipt, success: false }, { ...receipt, network: "stellar:pubnet" }, { ...receipt, payer: pool }, { ...receipt, transaction: "bad" }])("does not mistake HTTP 200 for settlement: %j", async (value) => {
    mocks.fetch.mockResolvedValue(paidResponse(value));
    expect(await payEndpoint(agent, url, options)).toMatchObject({ ok: false, paymentStatus: "unknown", stage: "settle" });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.rpc.getTransaction).not.toHaveBeenCalled();
  });
  it.each(["NOT_FOUND", "FAILED"])("does not claim a %s transaction succeeded", async (status) => {
    mocks.rpc.getTransaction.mockResolvedValue({ status });
    expect(await payEndpoint(agent, url, options)).toMatchObject({ ok: false, paymentStatus: "unknown" });
  });
  it("rejects wrong RPC network before accepting evidence", async () => {
    mocks.rpc.getNetwork.mockResolvedValue({ passphrase: Networks.PUBLIC });
    expect(await payEndpoint(agent, url, options)).toMatchObject({ ok: false, paymentStatus: "unknown" });
    expect(mocks.rpc.getTransaction).not.toHaveBeenCalled();
  });
  it("treats a lost HTTP response as uncertain and never retries the paid request", async () => {
    mocks.fetch.mockRejectedValue(new Error("connection lost"));
    expect(await payEndpoint(agent, url, options)).toMatchObject({ ok: false, paymentStatus: "unknown" });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
  });
  it("distinguishes confirmed payment from failed resource delivery", async () => {
    mocks.fetch.mockResolvedValue(paidResponse(receipt, 500));
    expect(await payEndpoint(agent, url, options)).toMatchObject({ ok: false, paymentStatus: "confirmed", status: 500, txHash: receipt.transaction });
  });
  it("rejects another transfer, reused receipt nonce, extra operations and bogus hashes", () => {
    for (const bad of [transaction(fee.publicKey(), transfer("200000")), transaction(fee.publicKey(), transfer("100000", "6"))]) {
      expect(() => assertSettlementMatches(prepared.toXDR(), bad.toEnvelope(), bad.hash().toString("hex"))).toThrow(/exact transfer/);
    }
    const extra = new TransactionBuilder(new Account(fee.publicKey(), "2"), { fee: "10000", networkPassphrase: Networks.TESTNET }).addOperation(transfer()).addOperation(transfer()).setTimeout(300).build();
    expect(() => assertSettlementMatches(prepared.toXDR(), extra.toEnvelope(), extra.hash().toString("hex"))).toThrow(/exact transfer/);
    expect(() => assertSettlementMatches(prepared.toXDR(), settled.toEnvelope(), "0".repeat(64))).toThrow(/hash/);
  });
  it("accepts a fee-bumped matching payment", () => {
    const feeBump = TransactionBuilder.buildFeeBumpTransaction(fee, "10000", settled, Networks.TESTNET);
    expect(() => assertSettlementMatches(prepared.toXDR(), feeBump.toEnvelope(), feeBump.hash().toString("hex"))).not.toThrow();
  });
});
