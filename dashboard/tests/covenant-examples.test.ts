import { describe, expect, it } from "vitest";
import { StrKey } from "@stellar/stellar-sdk";
import { appendAddress, X402_TESTNET_EXAMPLE } from "../lib/covenant-examples";

const OWNER = "GCNN4XIU3KU3QA6B3ENL752Q4J6ZBPOERRT54WV2P2N7GBLHCBNMHBOC";

describe("covenant examples", () => {
  it("uses a valid public payee and the official testnet endpoint", () => {
    expect(StrKey.isValidEd25519PublicKey(X402_TESTNET_EXAMPLE.payTo)).toBe(true);
    expect(new URL(X402_TESTNET_EXAMPLE.url).hostname).toBe("stellar.org");
    expect(X402_TESTNET_EXAMPLE.url).toMatch(/\/testnet$/);
  });
  it("fills an empty address field without inserting a URL", () => {
    expect(appendAddress(" \n", X402_TESTNET_EXAMPLE.payTo)).toBe(X402_TESTNET_EXAMPLE.payTo);
  });
  it("preserves existing user input when appending an example", () => {
    expect(appendAddress(OWNER, X402_TESTNET_EXAMPLE.payTo)).toBe(`${OWNER}\n${X402_TESTNET_EXAMPLE.payTo}`);
    expect(appendAddress("not a valid address", OWNER)).toBe(`not a valid address\n${OWNER}`);
  });
  it("does not duplicate an address, including comma- or whitespace-separated lists", () => {
    for (const list of [OWNER, `${OWNER}\n`, `${X402_TESTNET_EXAMPLE.payTo}, ${OWNER}`, ` ${OWNER}\t${X402_TESTNET_EXAMPLE.payTo}`]) {
      expect(appendAddress(list, OWNER)).toBe(list);
    }
  });
});
