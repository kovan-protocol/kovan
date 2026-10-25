// Server-only, one-use SEP-53 authorizations. Files share the keystore volume so
// challenges work across Node workers and restarts. They contain no private keys.
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { Keypair } from "@stellar/stellar-sdk";
import { keystorePath } from "./keystore";

export type KeyIntent = "generate" | "export";
type Scope = { intent: KeyIntent; owner: string; pool: string; origin: string; agent?: string; pubkeyHex?: string };
export type KeyChallenge = Scope & { id: string; expiresAt: number; message: string };
const LIFETIME_MS = 120_000;

export class KeyChallenges {
  constructor(private readonly directory: string, private readonly now = Date.now) {}

  create(scope: Scope): KeyChallenge {
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    // Bound disk use when a public endpoint issues challenges that go unsigned.
    const files = fs.readdirSync(this.directory).filter((f) => /^[a-f0-9]{64}\.json$/.test(f));
    let live = 0;
    for (const file of files) {
      const target = path.join(this.directory, file);
      try {
        if (this.now() - fs.statSync(target).mtimeMs > LIFETIME_MS) fs.unlinkSync(target);
        else live++;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
    }
    if (live >= 256) throw new Error("Too many pending key requests; try again in two minutes");
    const id = randomBytes(32).toString("hex");
    const expiresAt = this.now() + LIFETIME_MS;
    const message = [
      "Kovan agent signer authorization",
      `Action: ${scope.intent === "export" ? "Download a copy of my agent signer private key" : "Generate an app-managed agent signer key"}`,
      "Network: Stellar testnet",
      `Origin: ${scope.origin}`,
      `Owner: ${scope.owner}`,
      `Pool: ${scope.pool}`,
      ...(scope.agent ? [`Agent: ${scope.agent}`, `Signer: ${scope.pubkeyHex}`] : []),
      `Nonce: ${id}`,
      `Expires: ${new Date(expiresAt).toISOString()}`,
      "This message does not submit a transaction or transfer funds.",
    ].join("\n");
    const challenge = { ...scope, id, expiresAt, message };
    fs.writeFileSync(this.file(id), JSON.stringify(challenge), { flag: "wx", mode: 0o600 });
    return challenge;
  }

  consume(id: string, signature: string, intent: KeyIntent, origin: string): KeyChallenge {
    let challenge: KeyChallenge;
    try {
      challenge = JSON.parse(fs.readFileSync(this.file(id), "utf8")) as KeyChallenge;
    } catch {
      throw new Error("Key authorization is missing or already used; try again");
    }
    if (challenge.intent !== intent || challenge.origin !== origin) throw new Error("Key authorization does not match this request");
    if (this.now() >= challenge.expiresAt) throw new Error("Key authorization expired; try again");
    const bytes = Buffer.from(signature, "base64");
    if (bytes.length !== 64 || !Keypair.fromPublicKey(challenge.owner).verifyMessage(challenge.message, bytes)) {
      throw new Error("Key authorization needs a signature from the pool owner");
    }
    // Atomic across processes: only the request which removes the file succeeds.
    try {
      fs.unlinkSync(this.file(id));
    } catch {
      throw new Error("Key authorization was already used; try again");
    }
    return challenge;
  }

  private file(id: string): string {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("Invalid key authorization id");
    return path.join(this.directory, `${id}.json`);
  }
}

export function defaultKeyChallenges(): KeyChallenges {
  return new KeyChallenges(path.join(path.dirname(keystorePath()), "key-challenges"));
}
