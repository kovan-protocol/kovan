import { describe, expect, it } from "vitest";
import { Address, Keypair, Networks, xdr } from "@stellar/stellar-sdk";
import { authDigest, buildAuthPayload, signAgentEntry } from "@/lib/authpayload";

const ACCOUNT = "CAS7ARNTLTRAD4WLYGIXC5EVMFZBETIQROJ2UWOJGU4QQY5XQT3K2LKJ";
const VERIFIER = "CAEU4VYRTV4ZDHFGCRYQNPN6URDOYLP4TS4OMRAJX5RD7AMLWBTYW6G4";
const USDC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
// Printed by contracts/agent-account/src/test.rs::digest_vector (stellar-accounts 0.8.0).
const RUST_DIGEST = "0930fda6066fc480420923a8ddd91d71a98708a6b59f617ec8b61514699416a0";

describe("authDigest", () => {
  it("matches the Rust AuthDigestPreimage digest for fixed inputs", () => {
    const d = authDigest(ACCOUNT, Buffer.alloc(32, 7), [0]);
    expect(d.toString("hex")).toBe(RUST_DIGEST);
  });
});

describe("buildAuthPayload", () => {
  it("is a map with keys context_rule_ids and signers, signer = External(verifier, pubkey)", () => {
    const kp = Keypair.random();
    const sc = buildAuthPayload(VERIFIER, kp.rawPublicKey(), Buffer.alloc(64, 1), [0]);
    const keys = sc.map()!.map((e) => e.key().sym().toString());
    expect(keys).toEqual(["context_rule_ids", "signers"]);
    const signers = sc.map()![1].val().map()!;
    const signerKey = signers[0].key().vec()!;
    expect(signerKey[0].sym().toString()).toBe("External");
    expect(Address.fromScVal(signerKey[1]).toString()).toBe(VERIFIER);
    expect(Buffer.from(signerKey[2].bytes())).toEqual(kp.rawPublicKey());
    expect(signers[0].val().bytes()).toHaveLength(64);
  });
});

describe("signAgentEntry", () => {
  it("fills nonce, expiration and a valid signature over the auth digest", () => {
    const kp = Keypair.random();
    const inv = new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({
          contractAddress: new Address(USDC).toScAddress(),
          functionName: "transfer",
          args: [new Address(ACCOUNT).toScVal(), new Address(VERIFIER).toScVal(), xdr.ScVal.scvI128(new xdr.Int128Parts({ hi: xdr.Int64.fromString("0"), lo: xdr.Uint64.fromString("1000000") }))],
        }),
      ),
      subInvocations: [],
    });
    const unsigned = new xdr.SorobanAuthorizationEntry({
      credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
        new xdr.SorobanAddressCredentials({ address: new Address(ACCOUNT).toScAddress(), nonce: xdr.Int64.fromString("0"), signatureExpirationLedger: 0, signature: xdr.ScVal.scvVoid() }),
      ),
      rootInvocation: inv,
    });
    const signed = signAgentEntry(unsigned, { verifier: VERIFIER, secret: kp.secret(), networkPassphrase: Networks.TESTNET, expirationLedger: 5_400_100, ruleId: 0 });
    const creds = signed.credentials().address();
    expect(creds.signatureExpirationLedger()).toBe(5_400_100);
    expect(creds.nonce().toString()).not.toBe("0");
    const sig = creds.signature().map()![1].val().map()![0].val().bytes();
    // recompute: digest over (account, sha256(HashIdPreimage), [0]) must verify under the agent key
    const { payloadHash } = signAgentEntry.debugPayload(signed, Networks.TESTNET);
    const digest = authDigest(ACCOUNT, payloadHash, [0]);
    expect(kp.verify(digest, Buffer.from(sig))).toBe(true);
  });
});
