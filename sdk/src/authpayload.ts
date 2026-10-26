import { Buffer } from "buffer";
// Signing as a Kovan agent account (OpenZeppelin stellar-accounts 0.8.0).
//
// The account's only signer is External(verifier, pubkey). It does not sign the
// host's signature_payload directly; it signs the SHA-256 of the XDR of
//   AuthDigestPreimage { account, signature_payload, context_rule_ids }
// encoded as a Soroban struct (ScMap, keys sorted). The credentials' signature
// field then carries AuthPayload { signers: {signer: sig}, context_rule_ids }.
// Mirrors contracts/pool/src/test.rs::e2e and the Rust `digest_vector` test.
import { Address, buildAuthorizationEntryPreimage, hash, Keypair, StrKey, xdr } from "@stellar/stellar-sdk";
import { structVal } from "./scval.js";
import type { DigestSigner } from "./types.js";
import { paymentBindingToScVal, paymentPayloadHash, type PaymentBinding } from "./mandates.js";

const sym = (s: string) => xdr.ScVal.scvSymbol(s);

/** sha256(xdr(ScMap{account, context_rule_ids, signature_payload})). */
export function authDigest(account: string, signaturePayload: Buffer, ruleIds: number[]): Buffer {
  const preimage = structVal({
    account: new Address(account).toScVal(),
    signature_payload: xdr.ScVal.scvBytes(signaturePayload),
    context_rule_ids: xdr.ScVal.scvVec(ruleIds.map((id) => xdr.ScVal.scvU32(id))),
  });
  return hash(preimage.toXDR());
}

/** AuthPayload { signers: Map<Signer, Bytes>, context_rule_ids: Vec<u32> } with one External signer. */
export function buildAuthPayload(verifier: string, pubkey: Buffer, signature: Buffer, ruleIds: number[]): xdr.ScVal {
  const signer = xdr.ScVal.scvVec([sym("External"), new Address(verifier).toScVal(), xdr.ScVal.scvBytes(pubkey)]);
  const signers = xdr.ScVal.scvMap([new xdr.ScMapEntry({ key: signer, val: xdr.ScVal.scvBytes(signature) })]);
  return structVal({ signers, context_rule_ids: xdr.ScVal.scvVec(ruleIds.map((id) => xdr.ScVal.scvU32(id))) });
}

export type SignOpts = { verifier: string; secret: string; networkPassphrase: string; expirationLedger: number; ruleId?: number; payment?: PaymentBinding };

export function buildMandateAuthPayload(auth: xdr.ScVal, payment: PaymentBinding): xdr.ScVal {
  return structVal({ auth, payment: paymentBindingToScVal(payment), version: xdr.ScVal.scvU32(1) });
}

function randomNonce(): xdr.Int64 {
  const b = Keypair.random().rawPublicKey().subarray(0, 8);
  b[0] &= 0x7f; // keep it positive
  return xdr.Int64.fromString(b.readBigInt64BE().toString());
}

/** Fail closed on source-account and delegated credentials; support legacy and AddressV2. */
export function agentCredentials(entry: xdr.SorobanAuthorizationEntry): xdr.SorobanAddressCredentials {
  const c = entry.credentials();
  switch (c.switch().name) {
    case "sorobanCredentialsAddress": return c.address();
    case "sorobanCredentialsAddressV2": return c.addressV2();
    default: throw new Error(`refusing to sign: unsupported ${c.switch().name} credentials`);
  }
}

export function onlyAgentEntry<T>(entry: xdr.SorobanAuthorizationEntry, agent: string, sign: (entry: xdr.SorobanAuthorizationEntry) => T): T {
  const who = Address.fromScAddress(agentCredentials(entry).address()).toString();
  if (who !== agent) throw new Error(`refusing to sign: authorization is for ${who}, not the agent`);
  return sign(entry);
}

function payloadHashFor(entry: xdr.SorobanAuthorizationEntry, networkPassphrase: string): Buffer {
  return hash(buildAuthorizationEntryPreimage(entry, agentCredentials(entry).signatureExpirationLedger(), networkPassphrase).toXDR());
}

function prepareEntry(entry: xdr.SorobanAuthorizationEntry, expirationLedger: number) {
  if (!Number.isInteger(expirationLedger) || expirationLedger < 1 || expirationLedger > 0xffffffff) throw new Error("Invalid authorization expiry ledger");
  const clone = xdr.SorobanAuthorizationEntry.fromXDR(entry.toXDR());
  const creds = agentCredentials(clone);
  creds.nonce(randomNonce());
  creds.signatureExpirationLedger(expirationLedger);
  creds.signature(xdr.ScVal.scvVoid());
  return clone;
}

/** Takes the unsigned entry simulation returned for the agent account and signs it. */
export function signAgentEntry(entry: xdr.SorobanAuthorizationEntry, opts: SignOpts): xdr.SorobanAuthorizationEntry {
  const ruleId = opts.ruleId ?? 0;
  const kp = Keypair.fromSecret(opts.secret);
  const signed = prepareEntry(entry, opts.expirationLedger);
  const creds = agentCredentials(signed);
  const account = Address.fromScAddress(creds.address()).toString();
  const payloadHash = payloadHashFor(signed, opts.networkPassphrase);
  const digest = authDigest(account, opts.payment ? paymentPayloadHash(payloadHash, opts.payment) : payloadHash, [ruleId]);
  const sig = kp.sign(digest);
  const auth = buildAuthPayload(opts.verifier, kp.rawPublicKey(), sig, [ruleId]);
  creds.signature(opts.payment ? buildMandateAuthPayload(auth, opts.payment) : auth);
  return signed;
}

/** Test helper: recomputes the host signature payload hash of a signed entry. */
signAgentEntry.debugPayload = (entry: xdr.SorobanAuthorizationEntry, networkPassphrase: string) => ({
  payloadHash: payloadHashFor(entry, networkPassphrase),
});

export const agentPubkeyHex = (secret: string) => Keypair.fromSecret(secret).rawPublicKey().toString("hex");

/** Caller-owned key/HSM signer. No key generation, storage, or environment access. */
export async function signAgentAuthorization(entry: xdr.SorobanAuthorizationEntry, opts: {
  agent: string; verifier: string; networkPassphrase: string; expirationLedger: number; signer: DigestSigner;
  payment?: PaymentBinding;
}): Promise<xdr.SorobanAuthorizationEntry> {
  onlyAgentEntry(entry, opts.agent, () => undefined);
  if (!/^[a-fA-F0-9]{64}$/.test(opts.signer.publicKey)) throw new Error("Expected raw Ed25519 public key hex");
  const signed = prepareEntry(entry, opts.expirationLedger);
  const payment = opts.payment ? Object.freeze({ ...opts.payment }) : undefined;
  const hostPayload = payloadHashFor(signed, opts.networkPassphrase);
  const digest = authDigest(opts.agent, payment ? paymentPayloadHash(hostPayload, payment) : hostPayload, [0]);
  const publicKey = Buffer.from(opts.signer.publicKey, "hex");
  const signature = Buffer.from(await opts.signer.sign(Buffer.from(digest), {
    agent: opts.agent, networkPassphrase: opts.networkPassphrase, expirationLedger: opts.expirationLedger, entryXdr: signed.toXDR("base64"),
    ...(payment ? { payment } : {}),
  }));
  if (signature.length !== 64 || !Keypair.fromPublicKey(StrKey.encodeEd25519PublicKey(publicKey)).verify(digest, signature)) throw new Error("Agent signer returned an invalid signature");
  const auth = buildAuthPayload(opts.verifier, publicKey, signature, [0]);
  agentCredentials(signed).signature(payment ? buildMandateAuthPayload(auth, payment) : auth);
  return signed;
}
