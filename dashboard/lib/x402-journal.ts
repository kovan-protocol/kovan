import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { keystorePath } from "./keystore";
import type { X402Result } from "./agent-x402";

/** Local persistent idempotency, not an on-chain mandate or global replay service. */
export class PaymentJournal {
  constructor(private readonly directory: string) {}

  async run(requestId: string, fingerprint: string, execute: () => Promise<X402Result>): Promise<X402Result> {
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(requestId)) throw new Error("requestId must contain 16–128 letters, digits, hyphens or underscores");
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const file = path.join(this.directory, `${createHash("sha256").update(requestId).digest("hex")}.json`);
    let fd: number;
    try { fd = fs.openSync(file, "wx", 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let record: { fingerprint: string; result?: X402Result };
      try { record = JSON.parse(fs.readFileSync(file, "utf8")); }
      catch { throw new Error("Payment request is pending or interrupted; reconcile before creating a new requestId"); }
      if (record.fingerprint !== fingerprint) throw new Error("requestId was already used with different payment inputs");
      if (record.result) return record.result;
      throw new Error("Payment request is pending or interrupted; reconcile before creating a new requestId");
    }
    try { fs.writeFileSync(fd, JSON.stringify({ fingerprint })); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    // A crash or unexpected exception leaves the claim in place, never eligible for replay.
    const result = await execute();
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      const output = fs.openSync(temporary, "wx", 0o600);
      try { fs.writeFileSync(output, JSON.stringify({ fingerprint, result })); fs.fsyncSync(output); }
      finally { fs.closeSync(output); }
      fs.renameSync(temporary, file);
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    return result;
  }
}

export function paymentJournal(): PaymentJournal {
  return new PaymentJournal(path.join(path.dirname(keystorePath()), "x402-requests"));
}
