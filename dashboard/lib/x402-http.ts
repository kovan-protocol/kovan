// Untrusted resource URLs must never become a general-purpose server-side proxy.
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import { paymentUrl } from "./x402";

export function isPublicIpv4(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split(".").map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99)))
    || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
}

export async function publicTarget(value: string): Promise<{ url: URL; address: string }> {
  const url = new URL(paymentUrl(value));
  const hostname = url.hostname.toLowerCase();
  if (hostname.endsWith(".") || !hostname.includes(".") || /\.(localhost|local|internal|home|lan)$/.test(hostname) || hostname.includes(":")) throw new Error("Payment endpoint must be a public IPv4 HTTPS host");
  if (isIP(hostname)) {
    if (!isPublicIpv4(hostname)) throw new Error("Private or reserved payment endpoint refused");
    return { url, address: hostname };
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const addresses = await Promise.race([
    lookup(hostname, { all: true, family: 4 }),
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Payment endpoint DNS timed out")), 5000); }),
  ]).finally(() => clearTimeout(timer));
  if (!addresses.length || addresses.some(({ address }) => !isPublicIpv4(address))) throw new Error("Private or reserved payment endpoint refused");
  return { url, address: addresses[0].address };
}

export type ResourceResponse = { status: number; headers: Headers; body: string };

/** Pins the validated DNS result for this connection, validates TLS, never redirects/retries. */
export async function fetchPaymentResource(value: string, headers: Record<string, string> = {}): Promise<ResourceResponse> {
  const { url, address } = await publicTarget(value);
  return new Promise((resolve, reject) => {
    const req = request(url, {
      method: "GET", headers, agent: false, maxHeaderSize: 20_480,
      signal: AbortSignal.timeout(20_000),
      lookup: (_hostname, options, callback) => {
        if (options.all) callback(null, [{ address, family: 4 }]);
        else callback(null, address, 4);
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 65_536) { res.destroy(new Error("Payment resource response exceeds 64 KiB")); return; }
        chunks.push(chunk);
      });
      res.on("error", reject);
      res.on("end", () => {
        const resultHeaders = new Headers();
        for (const [name, value] of Object.entries(res.headers)) if (value !== undefined) resultHeaders.set(name, Array.isArray(value) ? value.join(", ") : value);
        resolve({ status: res.statusCode ?? 0, headers: resultHeaders, body: Buffer.concat(chunks).toString("utf8") });
      });
    });
    req.on("error", reject);
    req.end();
  });
}
