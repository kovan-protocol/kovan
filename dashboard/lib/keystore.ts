// Local agent keystore. Keys are generated on this machine:
// the file is git-ignored and mode 0600. Export requires owner authorization.
// Testnet tool; a production agent holds its own key.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Keypair } from "@stellar/stellar-sdk";

export type AgentKeyInfo = { label: string; publicKey: string; pubkeyHex: string; createdAt: string; owner?: string };
type Entry = AgentKeyInfo & { secret: string };

export class Keystore {
  constructor(private readonly file: string) {}

  private read(): Entry[] {
    if (!fs.existsSync(this.file)) return [];
    return JSON.parse(fs.readFileSync(this.file, "utf8")) as Entry[];
  }

  private write(entries: Entry[]) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify(entries, null, 2), { flag: "wx", mode: 0o600 });
      // Readers see a complete file, even while another process adds a key.
      fs.renameSync(temporary, this.file);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }

  private add(label: string, kp: Keypair, owner?: string): AgentKeyInfo {
    const info: AgentKeyInfo = { label, publicKey: kp.publicKey(), pubkeyHex: kp.rawPublicKey().toString("hex"), createdAt: new Date().toISOString(), ...(owner ? { owner } : {}) };
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const lockFile = `${this.file}.lock`;
    let lock: number;
    try {
      lock = fs.openSync(lockFile, "wx", 0o600);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST") throw new Error("Keystore is busy; try key generation again");
      throw e;
    }
    try {
      const entries = this.read().filter((e) => e.pubkeyHex !== info.pubkeyHex);
      entries.push({ ...info, secret: kp.secret() });
      this.write(entries);
      return info;
    } finally {
      fs.closeSync(lock);
      fs.unlinkSync(lockFile);
    }
  }

  generate(label: string, owner?: string): AgentKeyInfo {
    return this.add(label, Keypair.random(), owner);
  }

  importSecret(label: string, secret: string): AgentKeyInfo {
    return this.add(label, Keypair.fromSecret(secret));
  }

  /** Returns the key with this label, generating it on first use. */
  getOrCreate(label: string): AgentKeyInfo {
    const found = this.read().find((e) => e.label === label);
    if (found) {
      const { label: l, publicKey, pubkeyHex, createdAt } = found;
      return { label: l, publicKey, pubkeyHex, createdAt };
    }
    return this.generate(label);
  }

  secretForLabel(label: string): string | null {
    return this.read().find((e) => e.label === label)?.secret ?? null;
  }

  secretForPubkeyHex(hex: string): string | null {
    return this.read().find((e) => e.pubkeyHex === hex.toLowerCase())?.secret ?? null;
  }

  list(): AgentKeyInfo[] {
    return this.read().map(({ label, publicKey, pubkeyHex, createdAt, owner }) => ({ label, publicKey, pubkeyHex, createdAt, ...(owner ? { owner } : {}) }));
  }

  /** Only keys bound to a verified owner at generation can be exported. */
  exportForOwner(pubkeyHex: string, owner: string): { publicKey: string; secret: string } {
    const entry = this.read().find((e) => e.pubkeyHex === pubkeyHex);
    if (!entry || !entry.owner || entry.owner !== owner) {
      throw new Error("This signer key is not available for export to this wallet");
    }
    return { publicKey: entry.publicKey, secret: entry.secret };
  }
}

export function keystorePath(): string {
  return process.env.KOVAN_KEYSTORE ?? path.join(process.cwd(), ".keys", "agents.json");
}

/** Default store: dashboard/.keys/agents.json (git-ignored). */
export function defaultKeystore(): Keystore {
  return new Keystore(keystorePath());
}
