import { describe, expect, it, vi } from "vitest";
import { hash, Networks } from "@stellar/stellar-sdk";
import { currentRelease, releaseForHash, releaseContracts, resolvePoolRelease, structVal, addrVal, bytes32Val, u32Val, type DeploymentManifest } from "../src/index.js";
import { POOL, TOKEN, VERIFIER, owner, setup, simulation } from "./fixtures.js";

const code = Buffer.from("new mandate pool");
const oldCode = Buffer.from("old pool");
const manifest: DeploymentManifest = { network: "testnet", pool: POOL, owner: owner.publicKey(), policy: POOL, verifier: VERIFIER, usdc: TOKEN, account_wasm_hash: "1".repeat(64), pool_wasm_hash: hash(oldCode).toString("hex"),
  current_release: { policy: VERIFIER, verifier: VERIFIER, usdc: TOKEN, account_wasm_hash: "2".repeat(64), pool_wasm_hash: hash(code).toString("hex"), mandate_version: 1 } };
describe("multi-generation contract releases", () => {
  it("creates with the latest release, preserves the displayed old pool", () => {
    expect(currentRelease(manifest)).toBe(manifest.current_release);
    expect(releaseContracts(currentRelease(manifest)).policy).toBe(VERIFIER);
    expect(releaseForHash(manifest, manifest.pool_wasm_hash).policy).toBe(POOL);
  });
  it("rejects unknown code and non-testnet manifests", () => {
    expect(() => releaseForHash(manifest, "0".repeat(64))).toThrow(/untrusted/);
    expect(() => currentRelease({ ...manifest, network: "mainnet" })).toThrow(/testnet/);
  });
  it("refuses conflicting bindings for the same code", () => {
    expect(() => releaseForHash({ ...manifest, legacy_pools: [{ pool: TOKEN, pool_wasm_hash: manifest.pool_wasm_hash, policy: TOKEN }] }, manifest.pool_wasm_hash)).toThrow(/Ambiguous/);
  });
  it("resolves browser-created legacy pools without assuming the new policy", async () => {
    const { rpc } = setup(); rpc.getContractWasmByContractId.mockResolvedValue(oldCode);
    expect((await resolvePoolRelease({ rpc, networkPassphrase: Networks.TESTNET }, manifest, TOKEN)).policy).toBe(POOL);
    expect(rpc.simulateTransaction).not.toHaveBeenCalled();
  });
  it.each([false, true])("checks new pool constructor bindings (tampered=%s)", async tampered => {
    const { rpc } = setup(); rpc.getContractWasmByContractId.mockResolvedValue(code);
    const sim = simulation();
    sim.result!.retval = structVal({ policy: addrVal(tampered ? POOL : VERIFIER), verifier: addrVal(VERIFIER), usdc: addrVal(TOKEN), account_wasm_hash: bytes32Val("2".repeat(64)), mandate_version: u32Val(1) });
    rpc.simulateTransaction.mockResolvedValue(sim);
    const result = resolvePoolRelease({ rpc, networkPassphrase: Networks.TESTNET }, manifest, POOL);
    if (tampered) await expect(result).rejects.toThrow(/constructor bindings/);
    else expect((await result).mandate_version).toBe(1);
  });
});
