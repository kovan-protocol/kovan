import { describe as suite, expect, it } from "vitest";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { Buffer } from "buffer";
import { describeAgent, parsePlan, steps } from "../src/plan";
import { RequestError } from "../src/request";

const POOL = StrKey.encodeContract(Buffer.alloc(32, 7));
const P1 = Keypair.random().publicKey();
const P2 = Keypair.random().publicKey();
const R1 = StrKey.encodeContract(Buffer.alloc(32, 9));
const key = Keypair.random();

suite("setup links a chat agent can write", () => {
  it("reads a new pool with funding and two agents", () => {
    const plan = parsePlan(`?fund=100&agent=name:research,draw:40,pay:${P1}|${P2},per:0.5,total:40,hours:48&agent=name:ops,draw:40,send:${R1},send_per:1,send_total:5`)!;
    expect(plan.pool).toBeUndefined();
    expect(plan.fund).toBe(1_000_000_000n);
    expect(plan.agents.map((a) => a.name)).toEqual(["research", "ops"]);
    expect(plan.agents[0].req).toMatchObject({ providers: [P1, P2], providerPerTransferCap: 5_000_000n, providerTotalCap: 400_000_000n, expiryHours: 48 });
    expect(plan.agents[1].req).toMatchObject({ recipients: [R1], recipientTotalCap: 50_000_000n, expiryHours: 24 });
    expect(plan.agents.every((a) => !a.keyGiven)).toBe(true);
    expect(steps(plan).map((s) => s.kind)).toEqual(["create_pool", "fund", "agent", "agent"]);
  });

  it("tolerates spaces and URL-encoding, and uses a given agent key", () => {
    const plan = parsePlan(`?fund=10&agent=${encodeURIComponent(`name: bot 1, draw: 5, pay: ${P1}, per: 1, total: 5, key: ${key.publicKey()}`)}`)!;
    expect(plan.agents[0]).toMatchObject({ name: "bot 1", keyGiven: true, req: { agentKey: key.publicKey() } });
    expect(describeAgent(plan.agents[0]).at(-1)).toContain(key.publicKey());
  });

  it("can add agents to an existing pool without funding", () => {
    const plan = parsePlan(`?pool=${POOL}&agent=draw:5,pay:${P1},per:1,total:5`)!;
    expect(plan.pool).toBe(POOL);
    expect(plan.agents[0].req.pool).toBe(POOL);
    expect(steps(plan).map((s) => s.kind)).toEqual(["agent"]);
  });

  it("returns null for a bare page", () => {
    expect(parsePlan("")).toBeNull();
  });
});

suite("refusals", () => {
  const bad = (q: string, msg: RegExp) => expect(() => parsePlan(q)).toThrow(msg);
  it("refuses unknown fields and fields the link must not choose", () => {
    bad("?fund=1&policy=C", /Unknown link field "policy"/);
    bad(`?fund=10&agent=draw:5,pay:${P1},per:1,total:5,calls:x`, /unknown field "calls"/);
    bad(`?fund=10&agent=draw:5,pay:${P1},per:1,total:5,draw:6`, /appears twice/);
  });
  it("refuses draw limits above what a new pool is funded with", () => {
    bad(`?fund=10&agent=draw:8,pay:${P1},per:1,total:8&agent=draw:8,pay:${P1},per:1,total:8`, /add up to 16.00 USDC, more than the 10.00 USDC/);
    bad(`?agent=draw:1,pay:${P1},per:1,total:1`, /more than the 0.00 USDC/);
  });
  it("keeps every create_agent check, with the agent named in the error", () => {
    bad(`?fund=10&agent=name:x,draw:5,pay:${P1},per:6,total:5`, /Agent 1 \(x\): .*above provider_total_cap/);
    bad(`?fund=10&agent=draw:5,pay:${P1},per:1,total:5,key:${key.secret()}`, /SECRET/);
    bad(`?fund=10&agent=draw:5`, /at least one provider or recipient/);
    bad(`?fund=10&agent=draw:5,pay:MA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUAAAAAAAAAAAACJUQ,per:1,total:5`, /muxed/);
  });
  it("limits size and shape", () => {
    bad(`?fund=100${`&agent=draw:1,pay:${P1},per:1,total:1`.repeat(6)}`, /At most 5 agents/);
    bad("?fund=1&fund=2", /at most once/);
    bad("?pool=G123", /contract address/);
    expect(() => parsePlan("?fund=-1")).toThrow(RequestError);
    bad(`?fund=10&agent=name:<script>,draw:5,pay:${P1},per:1,total:5`, /name may use/);
  });
});
