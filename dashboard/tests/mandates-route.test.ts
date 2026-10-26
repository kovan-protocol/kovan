import { beforeEach, describe, expect, it, vi } from "vitest";
import { StrKey } from "@stellar/stellar-sdk";
const mocks = vi.hoisted(() => ({ assertPool: vi.fn(), requireMandates: vi.fn(), getMandate: vi.fn(), getPayment: vi.fn() }));
vi.mock("@/lib/kovan", () => ({ kovanClient: () => ({ assertPool: mocks.assertPool, pool: () => mocks }) }));
import { GET } from "@/app/api/mandates/route";
const agent = StrKey.encodeContract(Buffer.alloc(32, 1));
const pool = StrKey.encodeContract(Buffer.alloc(32, 2));
const id = "1".repeat(64);
beforeEach(() => { vi.resetAllMocks(); mocks.getMandate.mockResolvedValue({ spent: 100n, revoked: false }); mocks.getPayment.mockResolvedValue(null); });
describe("mandate chain reads", () => {
  it("checks trusted contracts and returns precision-safe, uncached state", async () => {
    const response = await GET(new Request(`http://localhost/api/mandates?${new URLSearchParams({ pool, agent, id })}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ version: 1, mandate: { spent: "100" }, payment: null });
    expect(mocks.assertPool).toHaveBeenCalledWith(pool);
    expect(mocks.requireMandates).toHaveBeenCalledWith(agent);
    expect(mocks.getMandate).toHaveBeenCalledWith(agent, id);
  });
  it("looks up payment receipts without issuing another payment", async () => {
    const response = await GET(new Request(`http://localhost/api/mandates?${new URLSearchParams({ pool, agent, paymentId: id })}`));
    expect(response.status).toBe(200);
    expect(mocks.getPayment).toHaveBeenCalledWith(agent, id);
    expect(mocks.getMandate).not.toHaveBeenCalled();
  });
  it("does not claim legacy accounts enforce mandates", async () => {
    mocks.requireMandates.mockRejectedValue(new Error("unsupported"));
    const response = await GET(new Request(`http://localhost/api/mandates?${new URLSearchParams({ pool, agent, id })}`));
    expect(response.status).toBe(422);
    expect(mocks.getMandate).not.toHaveBeenCalled();
  });
  it("rejects missing agent or IDs", async () => {
    expect((await GET(new Request("http://localhost/api/mandates"))).status).toBe(400);
    expect(mocks.assertPool).not.toHaveBeenCalled();
  });
  it.each(["invalid", "0".repeat(64), ""])("rejects malformed IDs before RPC reads", async id => {
    const response = await GET(new Request(`http://localhost/api/mandates?${new URLSearchParams({ pool, agent, id, paymentId: "1".repeat(64) })}`));
    expect(response.status).toBe(400);
    expect(mocks.assertPool).not.toHaveBeenCalled();
  });
});
