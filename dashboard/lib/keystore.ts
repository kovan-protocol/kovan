// Local agent keystore. Keys are generated on this machine and never leave it:
// the file is git-ignored, mode 0600, and the API only ever returns public parts.
// Testnet tool; a production agent holds its own key.
import fs from "node:fs";
import path from "node:path";
import { Keypair } from "@stellar/stellar-sdk";

export type AgentKeyInfo = { label: string; publicKey: string; pubkeyHex: string; createdAt: string };
type Entry = AgentKeyInfo & { secret: string };

export class Keystore {
  constructor(private readonly file: string) {}

  private read(): Entry[] {
    if (!fs.existsSync(this.file)) return [];
    return JSON.parse(fs.readFileSync(this.file, "utf8")) as Entry[];
  }

  private write(entries: Entry[]) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(this.file, JSON.stringify(entries, null, 2), { mode: 0o600 });
    fs.chmodSync(this.file, 0o600);
  }

  private add(label: string, kp: Keypair): AgentKeyInfo {
    const info: AgentKeyInfo = { label, publicKey: kp.publicKey(), pubkeyHex: kp.rawPublicKey().toString("hex"), createdAt: new Date().toISOString() };
    const entries = this.read().filter((e) => e.pubkeyHex !== info.pubkeyHex);
    entries.push({ ...info, secret: kp.secret() });
    this.write(entries);
    return info;
  }

  generate(label: string): AgentKeyInfo {
    return this.add(label, Keypair.random());
  }

  importSecret(label: string, secret: string): AgentKeyInfo {
    return this.add(label, Keypair.fromSecret(secret));
  }

  secretForPubkeyHex(hex: string): string | null {
    return this.read().find((e) => e.pubkeyHex === hex.toLowerCase())?.secret ?? null;
  }

  list(): AgentKeyInfo[] {
    return this.read().map(({ label, publicKey, pubkeyHex, createdAt }) => ({ label, publicKey, pubkeyHex, createdAt }));
  }
}

/** Default store: dashboard/.keys/agents.json (git-ignored). */
export function defaultKeystore(): Keystore {
  return new Keystore(process.env.KOVAN_KEYSTORE ?? path.join(process.cwd(), ".keys", "agents.json"));
}
