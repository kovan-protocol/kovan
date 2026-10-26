import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentJournal } from "@/lib/x402-journal";
import type { X402Result } from "@/lib/agent-x402";

let directory: string;
const id = "request_1234567890";
const result: X402Result = { ok: false, stage: "settle", paymentStatus: "unknown", error: "Timeout: reconcile first" };
beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), "kovan-x402-test-")); });
afterEach(() => { fs.rmSync(directory, { recursive: true, force: true }); });

describe("persistent payment request deduplication", () => {
  it("returns the original outcome after restart without issuing another authorization", async () => {
    const execute = vi.fn().mockResolvedValue(result);
    expect(await new PaymentJournal(directory).run(id, "fingerprint", execute)).toEqual(result);
    expect(await new PaymentJournal(directory).run(id, "fingerprint", execute)).toEqual(result);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(fs.statSync(path.join(directory, fs.readdirSync(directory)[0])).mode & 0o777).toBe(0o600);
  });
  it("rejects the same ID with different inputs", async () => {
    const execute = vi.fn().mockResolvedValue(result);
    const journal = new PaymentJournal(directory);
    await journal.run(id, "one", execute);
    await expect(journal.run(id, "two", execute)).rejects.toThrow(/different/);
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it("blocks concurrent attempts and preserves crashed claims", async () => {
    let release!: (value: X402Result) => void;
    const first = new PaymentJournal(directory).run(id, "one", () => new Promise((resolve) => { release = resolve; }));
    const execute = vi.fn().mockResolvedValue(result);
    await expect(new PaymentJournal(directory).run(id, "one", execute)).rejects.toThrow(/pending/);
    release(result);
    await first;
    await expect(new PaymentJournal(directory).run("interrupted_123456", "one", async () => { throw new Error("crash"); })).rejects.toThrow("crash");
    await expect(new PaymentJournal(directory).run("interrupted_123456", "one", execute)).rejects.toThrow(/interrupted/);
    expect(execute).not.toHaveBeenCalled();
  });
  it("rejects invalid IDs before executing", async () => {
    const execute = vi.fn();
    await expect(new PaymentJournal(directory).run("../bad", "one", execute)).rejects.toThrow(/requestId/);
    expect(execute).not.toHaveBeenCalled();
  });
});
