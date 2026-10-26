import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
vi.mock("node:https", () => ({ request: mocks.request }));
import { fetchPaymentResource, isPublicIpv4, publicTarget } from "@/lib/x402-http";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
});
describe("payment resource SSRF boundary", () => {
  it.each(["0.0.0.0", "10.0.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.0.1", "100.64.0.1", "192.0.0.8", "192.0.2.1", "192.88.99.1", "198.18.0.1", "198.51.100.1", "203.0.113.1", "224.0.0.1", "255.255.255.255", "::1"])('refuses special address %s', async (address) => {
    expect(isPublicIpv4(address)).toBe(false);
    mocks.lookup.mockResolvedValue([{ address, family: address.includes(":") ? 6 : 4 }]);
    await expect(publicTarget("https://example.com/path")).rejects.toThrow(/Private|reserved/);
  });
  it.each(["https://localhost", "https://host.local", "https://host.internal", "https://127.1", "https://2130706433", "https://[::1]", "https://example.com."])('rejects local or ambiguous host %s', async (url) => {
    await expect(publicTarget(url)).rejects.toThrow();
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("rejects mixed public/private DNS answers", async () => {
    mocks.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.1", family: 4 }]);
    await expect(fetchPaymentResource("https://example.com")).rejects.toThrow(/Private/);
    expect(mocks.request).not.toHaveBeenCalled();
  });
  function respond(status = 402, data = Buffer.from("body")) {
    mocks.request.mockImplementation((_url, _options, callback) => {
      const req = new EventEmitter() as EventEmitter & { end: () => void };
      req.end = () => queueMicrotask(() => {
        const events = new EventEmitter();
        const res = Object.assign(events, { statusCode: status, headers: { "content-type": "text/plain" }, destroy(error: Error) { events.emit("error", error); } });
        callback(res);
        res.emit("data", data);
        res.emit("end");
      });
      return req;
    });
  }
  it("pins the checked DNS address, preserves TLS hostname, and never follows redirects", async () => {
    respond(302);
    const result = await fetchPaymentResource("https://example.com/resource");
    expect(result.status).toBe(302);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    const [url, options] = mocks.request.mock.calls[0];
    expect(url.hostname).toBe("example.com");
    expect(options.agent).toBe(false);
    const callback = vi.fn();
    mocks.lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    options.lookup("example.com", { all: false }, callback);
    expect(callback).toHaveBeenCalledWith(null, "93.184.216.34", 4);
    await expect(fetchPaymentResource("https://example.com/resource")).rejects.toThrow(/Private/);
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });
  it("bounds response bodies", async () => {
    respond(200, Buffer.alloc(65_537));
    await expect(fetchPaymentResource("https://example.com")).rejects.toThrow(/64 KiB/);
  });
});
