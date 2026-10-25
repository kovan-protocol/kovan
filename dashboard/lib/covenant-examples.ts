// Public testnet example. Read the endpoint's current terms before paying;
// adding a payee here grants no access until the owner creates the agent.
export const X402_TESTNET_EXAMPLE = {
  url: "https://stellar.org/x402-demo/api/protected/testnet",
  payTo: "GCHEI4PQEFJOA27MNZRPQNLGURS6KASW76X5UZCUZIXCOJLKXYCXOR2W",
} as const;

/** Preserve user-entered addresses and formatting; never duplicate an example. */
export function appendAddress(list: string, address: string): string {
  if (list.split(/[\s,]+/).includes(address)) return list;
  return list.trimEnd() ? `${list.trimEnd()}\n${address}` : address;
}
