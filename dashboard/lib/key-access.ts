import { StrKey } from "@stellar/stellar-sdk";
import type { AgentKeyInfo } from "./keystore";

export type AgentSigning = { publicKey: string; mode: "managed" | "external"; exportable: boolean };

/** Public status only. An owner binding is never inferred from a chosen public key. */
export function agentSigning(pubkeyHex: string, owner: string, keys: AgentKeyInfo[], fallbackPubkeyHex?: string): AgentSigning {
  const key = keys.find((k) => k.pubkeyHex === pubkeyHex);
  return {
    publicKey: StrKey.encodeEd25519PublicKey(Buffer.from(pubkeyHex, "hex")),
    mode: key || fallbackPubkeyHex === pubkeyHex ? "managed" : "external",
    exportable: !!key?.owner && key.owner === owner,
  };
}
