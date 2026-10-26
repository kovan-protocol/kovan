import { Buffer } from "buffer";
import { Address, hash, Keypair, Operation, rpc, TransactionBuilder, xdr } from "@stellar/stellar-sdk";
import { buildAgentOp, buildCreatePoolOp, buildOwnerOp, type AgentAction, type AgentRequest, type OwnerArgs, type OwnerFn } from "./owner.js";
import { signAgentAuthorization } from "./authpayload.js";
import { addrVal, bytes32Val } from "./scval.js";
import { nonzeroBytes32, paymentBindingToScVal, type MandateState, type PaymentBinding, type PaymentReceipt } from "./mandates.js";
import { assemblePrepared, assertNetwork, checkedSimulation, KovanError, prepareOperation, signPrepared, simulateRead } from "./transport.js";
import { submitSigned, type SubmitResult } from "./submit.js";
import { assertPoolBindings, type PoolBindings } from "./deployments.js";
import type { AgentRecord, ContractConfig, CovenantState, DigestSigner, PoolInfo, PreparedTransaction, RpcClient, TransactionSigner } from "./types.js";

export type KovanConfig = {
  rpcUrl: string; networkPassphrase: string; contracts: ContractConfig;
  /** Explicit older code hashes accepted for existing-pool recovery, never new deployment. */
  legacyPoolWasmHashes?: string[];
  maxFeeStroops?: string;
  rpc?: RpcClient;
};

/** No global deployment IDs, environment reads, wallet dependency, or key storage. */
export class KovanClient {
  readonly rpc: RpcClient;
  readonly networkPassphrase: string;
  readonly contracts: Readonly<ContractConfig>;
  readonly maxFeeStroops: string;
  private readonly poolHashes: ReadonlySet<string>;
  constructor(config: KovanConfig) {
    if (!config.networkPassphrase.trim()) throw new Error("networkPassphrase is required");
    for (const field of ["usdc", "policy", "verifier"] as const) {
      if (!config.contracts[field].startsWith("C")) throw new Error(`${field} must be a contract address`);
      new Address(config.contracts[field]);
    }
    const hashes = [config.contracts.poolWasmHash, ...(config.legacyPoolWasmHashes ?? [])];
    [...hashes, config.contracts.accountWasmHash].forEach(bytes32Val);
    this.maxFeeStroops = config.maxFeeStroops ?? "10000000";
    if (!/^\d+$/.test(this.maxFeeStroops) || BigInt(this.maxFeeStroops) <= 0n) throw new Error("Invalid maxFeeStroops");
    this.contracts = Object.freeze({ ...config.contracts });
    this.poolHashes = new Set(hashes.map((h) => h.toLowerCase()));
    this.networkPassphrase = config.networkPassphrase;
    this.rpc = config.rpc ?? new rpc.Server(config.rpcUrl);
  }
  pool(address: string): PoolClient { return new PoolClient(this, address); }
  read<T>(address: string, fn: string, args: xdr.ScVal[] = []): Promise<T> { return simulateRead<T>(this, address, fn, args); }
  async assertPool(address: string): Promise<void> {
    const code = await this.rpc.getContractWasmByContractId(address);
    if (!this.poolHashes.has(hash(Buffer.from(code)).toString("hex"))) throw new KovanError("guard", "Pool does not run an explicitly trusted Kovan code hash");
    if (!this.contracts.legacyBindings) {
      assertPoolBindings(await this.read<PoolBindings>(address, "get_config"), this.contracts);
    }
  }
  async prepareCreatePool(owner: string, salt: Uint8Array = Keypair.random().rawPublicKey()): Promise<PreparedTransaction> {
    return prepareOperation(this, { source: owner, maxFeeStroops: this.maxFeeStroops, operation: buildCreatePoolOp({ owner, salt, ...this.contracts }) });
  }
  async signAndSend(prepared: PreparedTransaction, signer: TransactionSigner): Promise<SubmitResult> {
    if (prepared.networkPassphrase !== this.networkPassphrase) throw new KovanError("guard", "Prepared transaction belongs to another network");
    await assertNetwork(this);
    return this.submit(await signPrepared(prepared, signer));
  }
  submit(signedXdr: string): Promise<SubmitResult> {
    return submitSigned(this, signedXdr, { context: { usdc: this.contracts.usdc } });
  }
}

export class PoolClient {
  constructor(readonly client: KovanClient, readonly address: string) {
    if (!address.startsWith("C")) throw new Error("Pool must be a contract address");
    new Address(address);
  }
  async getPool(): Promise<PoolInfo> {
    const p = await this.client.read<PoolInfo>(this.address, "get_pool");
    return { ...p, agent_count: Number(p.agent_count) };
  }
  listAgents(): Promise<string[]> { return this.client.read(this.address, "list_agents"); }
  async getAgent(agent: string): Promise<AgentRecord & { state: CovenantState | null }> {
    const rec = await this.client.read<AgentRecord>(this.address, "get_agent", [addrVal(agent)]);
    let state: CovenantState | null = null;
    try { state = await this.client.read(this.client.contracts.policy, "get_covenant", [addrVal(agent)]); } catch { /* Report unavailable, never invent counters. */ }
    return { ...rec, state };
  }
  balance(account = this.address): Promise<bigint> { return this.client.read(this.client.contracts.usdc, "balance", [addrVal(account)]); }
  async requireMandates(agent?: string): Promise<void> {
    if (await this.client.read<number>(this.address, "mandate_version") !== 1 || (agent && await this.client.read<number>(agent, "mandate_version") !== 1)) {
      throw new KovanError("guard", "This pool/agent does not support mandate v1; deploy the new contracts");
    }
    if (agent) {
      const code = await this.client.rpc.getContractWasmByContractId(agent);
      if (hash(Buffer.from(code)).toString("hex") !== this.client.contracts.accountWasmHash.toLowerCase()) throw new KovanError("guard", "Mandate agent does not run the configured account code");
    }
  }
  async getMandate(agent: string, id: string): Promise<MandateState | null> {
    const records = await this.client.read<MandateState[]>(this.address, "get_mandate", [addrVal(agent), nonzeroBytes32(id)]);
    if (!Array.isArray(records) || records.length > 1) throw new KovanError("guard", "Invalid mandate response");
    return records[0] ?? null;
  }
  async getPayment(agent: string, id: string): Promise<PaymentReceipt | null> {
    const records = await this.client.read<PaymentReceipt[]>(this.address, "get_payment", [addrVal(agent), nonzeroBytes32(id)]);
    if (!Array.isArray(records) || records.length > 1) throw new KovanError("guard", "Invalid payment receipt response");
    return records[0] ?? null;
  }
  async getAgentSigner(agent: string): Promise<{ verifier: string; pubkeyHex: string }> {
    const rule = await this.client.read<{ signers: unknown[]; policies: string[] }>(agent, "get_context_rule", [xdr.ScVal.scvU32(0)]);
    const signer = rule.signers?.[0] as [string, string, Uint8Array] | undefined;
    if (!signer || signer[0] !== "External" || !(signer[2] instanceof Uint8Array) || rule.signers.length !== 1) throw new KovanError("guard", "Agent does not have the supported single External signer on rule 0");
    if (rule.policies?.length !== 1 || rule.policies[0] !== this.client.contracts.policy) throw new KovanError("guard", "Agent policy does not match the configured covenant policy");
    return { verifier: String(signer[1]), pubkeyHex: Buffer.from(signer[2]).toString("hex") };
  }
  private async checkedPool() {
    await assertNetwork(this.client);
    await this.client.assertPool(this.address);
    const p = await this.getPool();
    if (p.usdc !== this.client.contracts.usdc) throw new KovanError("guard", "Pool asset differs from configured settlement asset");
    return p;
  }
  async prepareOwner<F extends OwnerFn>(fn: F, args: OwnerArgs[F], source: string): Promise<PreparedTransaction> {
    const p = await this.checkedPool();
    if (source !== p.owner) throw new KovanError("guard", "Connect the original pool owner to prepare an owner transaction");
    if (fn === "close_pool" && typeof p.closed !== "boolean") throw new KovanError("guard", "This legacy pool does not support permanent closure");
    if (fn === "create_mandate" || fn === "revoke_mandate") await this.requireMandates((args as OwnerArgs["revoke_mandate"]).agent);
    return prepareOperation(this.client, { source, operation: buildOwnerOp(this.address, fn, args, p.usdc), maxFeeStroops: this.client.maxFeeStroops });
  }
  /** Signs only agent auth entries; the fee payer's envelope remains unsigned until signAndSend. */
  async prepareAgent(action: AgentAction, request: AgentRequest, options: { source: string; signer: DigestSigner; timeoutSeconds?: number }): Promise<PreparedTransaction> {
    const timeout = options.timeoutSeconds ?? 120;
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 300) throw new KovanError("guard", "Agent timeout must be between 1 and 300 seconds");
    if (request.payment && (action !== "pay" || request.to === this.address)) throw new KovanError("guard", "Mandates apply only to outgoing payments, not recovery or funding");
    await this.checkedPool();
    const rec = await this.getAgent(request.agent);
    if (rec.covenant.pool !== this.address || rec.covenant.usdc !== this.client.contracts.usdc) throw new KovanError("guard", "Agent is not bound to this pool and asset");
    const expected = await this.getAgentSigner(request.agent);
    if (expected.verifier !== this.client.contracts.verifier || expected.pubkeyHex !== options.signer.publicKey.toLowerCase()) throw new KovanError("guard", "Agent signer or verifier does not match the on-chain account");
    const operation = buildAgentOp(this.address, this.client.contracts.usdc, action, request);
    const latest = await this.client.rpc.getLatestLedger();
    let expirationLedger = latest.sequence + Math.ceil(timeout / 5);
    let payment: PaymentBinding | undefined;
    if (request.payment) {
      // Validate commitments before asking the external signer to authorize anything.
      paymentBindingToScVal({ ...request.payment, validUntil: request.payment.validUntil ?? expirationLedger + 1 });
      await this.requireMandates(request.agent);
      const mandate = await this.getMandate(request.agent, request.payment.mandateId);
      if (!mandate || mandate.revoked) throw new KovanError("guard", "Mandate is missing or revoked");
      const deadline = Math.min(mandate.params.expiry, rec.covenant.expiry, expirationLedger + 1);
      const validUntil = request.payment.validUntil ?? deadline;
      if (!Number.isSafeInteger(validUntil) || validUntil <= latest.sequence || validUntil > mandate.params.expiry || validUntil > rec.covenant.expiry) throw new KovanError("guard", "Payment deadline exceeds the active mandate/covenant");
      payment = Object.freeze({ ...request.payment, validUntil });
      if (await this.getPayment(request.agent, payment.paymentId)) throw new KovanError("guard", "PaymentConsumed: this payment ID already settled; do not pay again");
      expirationLedger = Math.min(expirationLedger, validUntil - 1);
    }
    const source = await this.client.rpc.getAccount(options.source);
    const tx = new TransactionBuilder(source, { fee: "1000", networkPassphrase: this.client.networkPassphrase }).addOperation(operation).setTimeout(timeout).build();
    const context = { pool: this.address, usdc: this.client.contracts.usdc };
    const sim = checkedSimulation(await this.client.rpc.simulateTransaction(tx), context);
    const entries = sim.result?.auth ?? [];
    if (entries.length !== 1) throw new KovanError("guard", "Expected exactly one agent authorization entry");
    const call = operation.body().invokeHostFunctionOp().hostFunction().invokeContract();
    for (const entry of entries) {
      const root = entry.rootInvocation();
      if (root.function().switch().name !== "sorobanAuthorizedFunctionTypeContractFn" || !root.function().contractFn().toXDR().equals(call.toXDR()) || root.subInvocations().length !== 0) {
        throw new KovanError("guard", "Simulation requested an unexpected authorization invocation");
      }
    }
    const signed = await Promise.all(entries.map((entry) => signAgentAuthorization(entry, { agent: request.agent, verifier: expected.verifier, networkPassphrase: this.client.networkPassphrase, expirationLedger, signer: options.signer, payment })));
    const source2 = await this.client.rpc.getAccount(options.source);
    const tx2 = new TransactionBuilder(source2, { fee: "1000", networkPassphrase: this.client.networkPassphrase })
      .addOperation(Operation.invokeHostFunction({ func: operation.body().invokeHostFunctionOp().hostFunction(), auth: signed })).setTimeout(timeout).build();
    // Enforce custom auth and covenant constraints before returning a fee-payer transaction.
    const verified = checkedSimulation(await this.client.rpc.simulateTransaction(tx2, undefined, "enforce"), context);
    return assemblePrepared(tx2, verified, this.client.maxFeeStroops);
  }
}
