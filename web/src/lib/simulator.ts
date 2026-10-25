export const DRAW = 0.5;
export const PER = 0.1;
export const TOTAL = 0.4;

export type Payee = "provider" | "unlisted" | "self";

export type Failure = {
  index: number;
  tone: "ok" | "deny" | "ice";
  icon: string;
  title: string;
  detail: string;
  short: string;
};

export function evaluatePayment(input: {
  amount: number;
  payee: Payee;
  drawn: number;
  spent: number;
  revoked: boolean;
  expired: boolean;
}): Failure | null {
  const { amount: a, payee: p, drawn, spent, revoked, expired } = input;
  const fmt = (n: number) => n.toFixed(2);
  const tests: Array<() => Omit<Failure, "index"> | null> = [
    () =>
      revoked
        ? {
            tone: "ice",
            icon: "❄",
            title: "Frozen by the owner.",
            detail: "Revoked agents can’t draw or pay. return_funds still works.",
            short: "revoked",
          }
        : expired
          ? {
              tone: "deny",
              icon: "✕",
              title: "Covenant expired.",
              detail: "Authority ended at the expiry ledger. Unspent funds can be returned to the pool.",
              short: "expired",
            }
          : null,
    () =>
      drawn + a > DRAW + 1e-9
        ? {
            tone: "deny",
            icon: "✕",
            title: "Draw limit reached.",
            detail: `This would draw ${fmt(drawn + a)} of a ${fmt(DRAW)} limit. The pool refuses.`,
            short: "over limit",
          }
        : null,
    () =>
      p === "unlisted"
        ? {
            tone: "deny",
            icon: "✕",
            title: "Payee not in the covenant.",
            detail: "GDX7…Q2LM isn’t on the allowlist, so the wallet won’t authorize the transfer.",
            short: "not listed",
          }
        : p === "self"
          ? {
              tone: "deny",
              icon: "✕",
              title: "Admin call rejected.",
              detail: "The wallet has no admin rule, and the policy blocks calls to itself. The agent can’t rewrite its rules.",
              short: "blocked",
            }
          : null,
    () =>
      a > PER + 1e-9
        ? {
            tone: "deny",
            icon: "✕",
            title: "Over the per-transfer cap.",
            detail: `${fmt(a)} USDC is above the ${fmt(PER)} cap for this payee.`,
            short: "over cap",
          }
        : spent + a > TOTAL + 1e-9
          ? {
              tone: "deny",
              icon: "✕",
              title: "Total cap reached.",
              detail: `This would bring payments to ${fmt(spent + a)} of a ${fmt(TOTAL)} total.`,
              short: "total cap",
            }
          : null,
  ];

  for (let index = 0; index < tests.length; index++) {
    const result = tests[index]();
    if (result) return { index, ...result };
  }
  return null;
}
