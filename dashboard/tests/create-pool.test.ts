import { describe, expect, it } from "vitest";
import { Address, xdr } from "@stellar/stellar-sdk";
import { buildCreatePoolOp } from "@/lib/owner";

const OWNER = "GCNN4XIU3KU3QA6B3ENL752Q4J6ZBPOERRT54WV2P2N7GBLHCBNMHBOC";
const USDC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const POLICY = "CDEQUCR4OHOQHWPIP5RONRR46G7DTJMFZKNKRIQJCLYACDDZGWKAISD2";
const VERIFIER = "CAEU4VYRTV4ZDHFGCRYQNPN6URDOYLP4TS4OMRAJX5RD7AMLWBTYW6G4";
const POOL_WASM = "5b109988479d4dd9ad430944b890edfdb3445139a9a2f9a76593a77ad673745a";
const ACCOUNT_WASM = "25dabe1afc7a1ef93a0bc7b40ffa784e0a70463db91c4b1812fc155768ead2d7";

describe("buildCreatePoolOp", () => {
  it("creates a contract from the pool wasm with the five constructor args", () => {
    const op = buildCreatePoolOp({ owner: OWNER, usdc: USDC, poolWasmHash: POOL_WASM, accountWasmHash: ACCOUNT_WASM, policy: POLICY, verifier: VERIFIER, salt: Buffer.alloc(32, 9) });
    const hf = op.body().invokeHostFunctionOp().hostFunction();
    expect(hf.switch()).toBe(xdr.HostFunctionType.hostFunctionTypeCreateContractV2());
    const cc = hf.createContractV2();
    expect(cc.executable().wasmHash().toString("hex")).toBe(POOL_WASM);
    const pre = cc.contractIdPreimage().fromAddress();
    expect(Address.fromScAddress(pre.address()).toString()).toBe(OWNER);
    const args = cc.constructorArgs();
    expect(args).toHaveLength(5);
    expect(Address.fromScVal(args[0]).toString()).toBe(OWNER);
    expect(Address.fromScVal(args[1]).toString()).toBe(USDC);
    expect(Buffer.from(args[2].bytes()).toString("hex")).toBe(ACCOUNT_WASM);
    expect(Address.fromScVal(args[3]).toString()).toBe(POLICY);
    expect(Address.fromScVal(args[4]).toString()).toBe(VERIFIER);
  });
  it("needs the owner's auth (source address in the preimage)", () => {
    const op = buildCreatePoolOp({ owner: OWNER, usdc: USDC, poolWasmHash: POOL_WASM, accountWasmHash: ACCOUNT_WASM, policy: POLICY, verifier: VERIFIER, salt: Buffer.alloc(32, 1) });
    expect(op.body().invokeHostFunctionOp().auth()).toHaveLength(0); // simulation fills auth; owner signs it via Freighter
  });
});
