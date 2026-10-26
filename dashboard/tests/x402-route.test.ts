import { beforeEach, describe, expect, it, vi } from "vitest";
import { StrKey } from "@stellar/stellar-sdk";
const mocks = vi.hoisted(() => ({ discover: vi.fn(), pay: vi.fn(), run: vi.fn() }));
vi.mock("@/lib/agent-x402", () => ({ discoverTerms: mocks.discover, payEndpoint: mocks.pay, publicTerms: (terms: unknown) => terms }));
vi.mock("@/lib/x402-journal", () => ({ paymentJournal: () => ({ run: mocks.run }) }));
import { GET, POST } from "@/app/api/x402/route";

const agent = StrKey.encodeContract(Buffer.alloc(32, 1));
const pool = StrKey.encodeContract(Buffer.alloc(32, 2));
const body = { agent, pool, url: "https://example.com/paid", quoteId: "a".repeat(64), requestId: "request_1234567890" };
function post(value: unknown = body, headers: Record<string, string> = {}, origin = "http://localhost:3001") {
  return POST(new Request(`${origin}/api/x402`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(value) }));
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.run.mockImplementation((_id, _fingerprint, execute) => execute());
  mocks.pay.mockResolvedValue({ ok: false, paymentStatus: "unknown", stage: "settle", error: "reconcile first" });
});
describe("local x402 API", () => {
  it("includes the mandate in the journal fingerprint and passes the stable request ID", async () => {
    await post();
    const original = mocks.run.mock.calls[0][1];
    const mandateId = "1".repeat(64);
    expect((await post({ ...body, mandateId })).status).toBe(422);
    expect(mocks.run.mock.calls[1][1]).not.toBe(original);
    expect(mocks.pay).toHaveBeenLastCalledWith(agent, body.url, { pool, quoteId: body.quoteId, requestId: body.requestId, mandateId });
  });
  it.each(["bad", "0".repeat(64), 1, null])("rejects invalid mandate ID %j", async mandateId => {
    expect((await post({ ...body, mandateId })).status).toBe(400);
    expect(mocks.pay).not.toHaveBeenCalled();
  });
  it("requires an explicit reviewed quote and request ID", async () => {
    expect((await post({ agent, url: body.url })).status).toBe(400);
    expect(mocks.pay).not.toHaveBeenCalled();
  });
  it.each([null, [], "text", { ...body, agent: "bad" }, { ...body, pool: "bad" }, { ...body, quoteId: "bad" }, { ...body, skipCovenant: true }, { ...body, url: "x".repeat(5000) }])("rejects malformed or unsupported input %j", async (value) => {
    expect((await post(value)).status).toBe(400);
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.pay).not.toHaveBeenCalled();
  });
  it("passes the selected pool and binds the idempotency claim to all inputs", async () => {
    expect((await post()).status).toBe(422);
    expect(mocks.pay).toHaveBeenCalledWith(agent, body.url, { pool, quoteId: body.quoteId });
    expect(mocks.run).toHaveBeenCalledWith(body.requestId, expect.stringMatching(/^[a-f0-9]{64}$/), expect.any(Function));
    const first = mocks.run.mock.calls[0][1];
    await post({ ...body, pool: agent });
    expect(mocks.run.mock.calls[1][1]).not.toBe(first);
  });
  it("accepts a same-origin loopback request when Next reconstructs an internal localhost URL", async () => {
    expect((await post(body, { host: "127.0.0.1:3001", origin: "http://127.0.0.1:3001" })).status).toBe(422);
    expect(mocks.pay).toHaveBeenCalledTimes(1);
  });
  it("returns 409 for pending/changed idempotency requests", async () => {
    mocks.run.mockRejectedValue(new Error("Payment request is pending"));
    expect((await post()).status).toBe(409);
    expect(mocks.pay).not.toHaveBeenCalled();
  });
  it.each<Record<string, string>>([{ origin: "https://evil.example" }, { origin: "null" }, { host: "evil.example" }, { "sec-fetch-site": "cross-site" }, { "content-type": "text/plain" }])("blocks cross-site requests %j", async (headers) => {
    expect((await post(body, headers)).status).toBe(403);
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it("blocks public-host signing and cross-site discovery", async () => {
    expect((await post(body, {}, "https://public.example")).status).toBe(403);
    expect((await GET(new Request(`http://localhost/api/x402?url=${encodeURIComponent(body.url)}`, { headers: { "sec-fetch-site": "cross-site" } }))).status).toBe(403);
    expect(mocks.discover).not.toHaveBeenCalled();
  });
  it("does not cache discovery quotes", async () => {
    mocks.discover.mockResolvedValue({ ...body, amount: "100000" });
    const response = await GET(new Request(`http://localhost/api/x402?url=${encodeURIComponent(body.url)}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await response.json()).quoteId).toBe(body.quoteId);
    expect(mocks.pay).not.toHaveBeenCalled();
  });
});
