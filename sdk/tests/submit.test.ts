import { describe, expect, it } from "vitest";
import { nativeToScVal, Networks } from "@stellar/stellar-sdk";
import { transactionStatus } from "../src/index.js";
import { setup } from "./fixtures.js";

describe("transactionStatus", () => {
  it("reconciles the original hash and return value without broadcasting", async () => {
    const { client, rpc } = setup();
    const hash = "ab".repeat(32);
    rpc.getTransaction.mockResolvedValue({ status: "SUCCESS", returnValue: nativeToScVal(5n, { type: "i128" }) });
    expect(await transactionStatus(client, hash)).toEqual({ hash, status: "SUCCESS", returnValue: 5n });
    expect(rpc.getTransaction).toHaveBeenCalledWith(hash);
    expect(rpc.sendTransaction).not.toHaveBeenCalled();
    expect(rpc.simulateTransaction).not.toHaveBeenCalled();
  });
  it.each(["NOT_FOUND", "FAILED"])("preserves %s without signing or submitting", async status => {
    const { client, rpc } = setup(); const hash = "ab".repeat(32);
    rpc.getTransaction.mockResolvedValue({ status });
    expect(await transactionStatus(client, hash)).toMatchObject({ hash, status });
    expect(rpc.sendTransaction).not.toHaveBeenCalled();
  });
  it("rejects malformed hashes and a different network", async () => {
    const { client, rpc } = setup();
    await expect(transactionStatus(client, "bad hash")).rejects.toThrow("Invalid transaction hash");
    expect(rpc.getTransaction).not.toHaveBeenCalled();
    rpc.getNetwork.mockResolvedValue({ passphrase: Networks.PUBLIC });
    await expect(transactionStatus(client, "ab".repeat(32))).rejects.toThrow();
    expect(rpc.getTransaction).not.toHaveBeenCalled(); expect(rpc.sendTransaction).not.toHaveBeenCalled();
  });
});
