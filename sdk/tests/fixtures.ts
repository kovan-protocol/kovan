import { Account, Address, hash, Keypair, nativeToScVal, Networks, SorobanDataBuilder, StrKey, xdr } from "@stellar/stellar-sdk";
import { vi } from "vitest";
import { KovanClient } from "../src/index.js";

export const POOL = StrKey.encodeContract(Buffer.alloc(32, 1));
export const AGENT = StrKey.encodeContract(Buffer.alloc(32, 2));
export const TOKEN = StrKey.encodeContract(Buffer.alloc(32, 3));
export const POLICY = StrKey.encodeContract(Buffer.alloc(32, 4));
export const VERIFIER = StrKey.encodeContract(Buffer.alloc(32, 5));
export const owner = Keypair.random();
export const agentKey = Keypair.random();
export const code = Buffer.from("test code only");
export const config = { usdc: TOKEN, policy: POLICY, verifier: VERIFIER, poolWasmHash: hash(code).toString("hex"), accountWasmHash: "a".repeat(64) };
export const covenant = { providers: [owner.publicKey()], provider_per_transfer_cap: "2000000", provider_total_cap: "5000000", recipients: [], recipient_per_transfer_cap: "0", recipient_total_cap: "0", calls: [], expiry: 1000 };
export const poolInfo = { owner: owner.publicKey(), usdc: TOKEN, locked: 10000000n, sum_limits: 0n, agent_count: 1, accounting_version: 2, balance: 10000000n, closed: false };
export function simulation(retval = xdr.ScVal.scvVoid(), auth: xdr.SorobanAuthorizationEntry[] = []) {
  return { _parsed: true as const, id: "test", latestLedger: 100, minResourceFee: "100", transactionData: new SorobanDataBuilder(), result: { retval, auth }, events: [] };
}
export function entry(invocation?: xdr.SorobanAuthorizedInvocation, kind = "legacy", address = AGENT) {
  const inv = invocation ?? new xdr.SorobanAuthorizedInvocation({ function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(new xdr.InvokeContractArgs({ contractAddress: new Address(POOL).toScAddress(), functionName: "draw", args: [new Address(AGENT).toScVal(), nativeToScVal(1n, { type: "i128" })] })), subInvocations: [] });
  const creds = new xdr.SorobanAddressCredentials({ address: new Address(address).toScAddress(), nonce: xdr.Int64.fromString("123"), signatureExpirationLedger: 0, signature: xdr.ScVal.scvVoid() });
  return new xdr.SorobanAuthorizationEntry({ rootInvocation: inv, credentials: kind === "source" ? xdr.SorobanCredentials.sorobanCredentialsSourceAccount() : kind === "v2" ? xdr.SorobanCredentials.sorobanCredentialsAddressV2(creds) : xdr.SorobanCredentials.sorobanCredentialsAddress(creds) });
}
export function setup() {
  const rpc = {
    getNetwork: vi.fn().mockResolvedValue({ passphrase: Networks.TESTNET }),
    getAccount: vi.fn().mockImplementation(async (address: string) => new Account(address, "1")),
    getLatestLedger: vi.fn().mockResolvedValue({ sequence: 100 }),
    getContractWasmByContractId: vi.fn().mockResolvedValue(code),
    simulateTransaction: vi.fn().mockResolvedValue(simulation()),
    sendTransaction: vi.fn().mockResolvedValue({ status: "PENDING", hash: "b".repeat(64) }),
    getTransaction: vi.fn().mockResolvedValue({ status: "SUCCESS", returnValue: xdr.ScVal.scvVoid() }),
  };
  const client = new KovanClient({ rpcUrl: "https://rpc.example", networkPassphrase: Networks.TESTNET, contracts: config, rpc });
  return { rpc, client, pool: client.pool(POOL) };
}
