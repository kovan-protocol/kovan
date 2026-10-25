// Signing as a Kovan agent account (OpenZeppelin stellar-accounts 0.8.0).
//
// The account's only signer is External(verifier, pubkey). It does not sign the
// host's signature_payload directly; it signs the SHA-256 of the XDR of
//   AuthDigestPreimage { account, signature_payload, context_rule_ids }
// encoded as a Soroban struct (ScMap, keys sorted). The credentials' signature
// field then carries AuthPayload { signers: {signer: sig}, context_rule_ids }.
// Mirrors contracts/pool/src/test.rs::e2e and the Rust `digest_vector` test.
import { Address, hash, Keypair, xdr } from "@stellar/stellar-sdk";
import { structVal } from "./scval";

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

export type SignOpts = { verifier: string; secret: string; networkPassphrase: string; expirationLedger: number; ruleId?: number };

function randomNonce(): xdr.Int64 {
  const b = Keypair.random().rawPublicKey().subarray(0, 8);
  b[0] &= 0x7f; // keep it positive
  return xdr.Int64.fromString(b.readBigInt64BE().toString());
}

function payloadHashFor(creds: xdr.SorobanAddressCredentials, invocation: xdr.SorobanAuthorizedInvocation, networkPassphrase: string): Buffer {
  const preimage = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
    new xdr.HashIdPreimageSorobanAuthorization({
      networkId: hash(Buffer.from(networkPassphrase)),
      nonce: creds.nonce(),
      signatureExpirationLedger: creds.signatureExpirationLedger(),
      invocation,
    }),
  );
  return hash(preimage.toXDR());
}

/** Takes the unsigned entry simulation returned for the agent account and signs it. */
export function signAgentEntry(entry: xdr.SorobanAuthorizationEntry, opts: SignOpts): xdr.SorobanAuthorizationEntry {
  const ruleId = opts.ruleId ?? 0;
  const kp = Keypair.fromSecret(opts.secret);
  const old = entry.credentials().address();
  const account = Address.fromScAddress(old.address()).toString();
  const creds = new xdr.SorobanAddressCredentials({
    address: old.address(),
    nonce: randomNonce(),
    signatureExpirationLedger: opts.expirationLedger,
    signature: xdr.ScVal.scvVoid(),
  });
  const payloadHash = payloadHashFor(creds, entry.rootInvocation(), opts.networkPassphrase);
  const digest = authDigest(account, payloadHash, [ruleId]);
  const sig = kp.sign(digest);
  creds.signature(buildAuthPayload(opts.verifier, kp.rawPublicKey(), sig, [ruleId]));
  return new xdr.SorobanAuthorizationEntry({ credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(creds), rootInvocation: entry.rootInvocation() });
}

/** Test helper: recomputes the host signature payload hash of a signed entry. */
signAgentEntry.debugPayload = (entry: xdr.SorobanAuthorizationEntry, networkPassphrase: string) => ({
  payloadHash: payloadHashFor(entry.credentials().address(), entry.rootInvocation(), networkPassphrase),
});

export const agentPubkeyHex = (secret: string) => Keypair.fromSecret(secret).rawPublicKey().toString("hex");
