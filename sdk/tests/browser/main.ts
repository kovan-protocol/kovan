import { Buffer } from "buffer";
import { Account, Address, Keypair, Networks, StrKey, TransactionBuilder, scValToNative, xdr } from "@stellar/stellar-sdk";
import { buildOwnerOp, keypairTransactionSigner, signPrepared, signAgentAuthorization, agentCredentials, jsonSafe, paymentIdForRequest } from "@kovan-protocol/sdk";

async function run() {
  if ("Buffer" in window) throw new Error("Test must run without a global Buffer polyfill");
  const pool = StrKey.encodeContract(Buffer.alloc(32, 1));
  const agent = StrKey.encodeContract(Buffer.alloc(32, 2));
  const verifier = StrKey.encodeContract(Buffer.alloc(32, 3));
  const owner = Keypair.random();
  const key = Keypair.random();
  const op = buildOwnerOp(pool, "fund", { amount: "1000000" });
  const tx = new TransactionBuilder(new Account(owner.publicKey(), "1"), { networkPassphrase: Networks.TESTNET, fee: "1000" }).addOperation(op).setTimeout(120).build();
  const signed = await signPrepared({ xdr: tx.toXDR(), source: owner.publicKey(), hash: tx.hash().toString("hex"), networkPassphrase: Networks.TESTNET, preview: null }, keypairTransactionSigner(owner));
  if (TransactionBuilder.fromXDR(signed, Networks.TESTNET).signatures.length !== 1) throw new Error("Missing browser envelope signature");
  const entry = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(new xdr.SorobanAddressCredentials({ address: new Address(agent).toScAddress(), nonce: xdr.Int64.fromString("1"), signatureExpirationLedger: 0, signature: xdr.ScVal.scvVoid() })),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({ function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(op.body().invokeHostFunctionOp().hostFunction().invokeContract()), subInvocations: [] }),
  });
  const auth = await signAgentAuthorization(entry, { agent, verifier, networkPassphrase: Networks.TESTNET, expirationLedger: 160, signer: { publicKey: key.rawPublicKey().toString("hex"), sign: digest => key.sign(Buffer.from(digest)) } });
  if (agentCredentials(auth).signature().switch().name !== "scvMap") throw new Error("Missing browser custom authorization");
  const payment = { mandateId: "01".repeat(32), paymentId: paymentIdForRequest("browser_purchase_0001"), reference: "02".repeat(32), validUntil: 161 };
  buildOwnerOp(pool, "create_mandate", { agent, params: { id: payment.mandateId, intent_hash: "03".repeat(32), expiry: 1000, scope: { kind: "budget", payees: [owner.publicKey()], per_payment_cap: "100000", total_cap: "500000" } } });
  const bound = await signAgentAuthorization(entry, { agent, verifier, networkPassphrase: Networks.TESTNET, expirationLedger: 160, payment, signer: { publicKey: key.rawPublicKey().toString("hex"), sign: (digest, context) => {
    if (context.payment?.paymentId !== payment.paymentId) throw new Error("Missing mandate signer context");
    return key.sign(Buffer.from(digest));
  } } });
  const envelope = scValToNative(agentCredentials(bound).signature());
  if (envelope.version !== 1 || Buffer.from(envelope.payment.payment_id).toString("hex") !== payment.paymentId) throw new Error("Missing browser mandate binding");
  if (JSON.stringify(jsonSafe({ n: 9007199254740993n })) !== '{"n":"9007199254740993"}') throw new Error("Precision lost");
  return "PASS: browser import, operation construction, envelope signing, AddressV2 legacy/mandate signing and bigint serialization; no global Buffer, backend or network writes";
}
run().then(result => {
  Object.assign(window, { sdkResult: { ok: true, result } });
  document.querySelector("#result")!.textContent = result;
}).catch(error => { Object.assign(window, { sdkResult: { ok: false, error: String(error) } }); });
