import fs from "node:fs";
import path from "node:path";
import { currentRelease, type DeploymentManifest } from "@kovan-protocol/sdk";
import type { NativeYieldSource } from "@kovan-protocol/sdk/experimental";
import { deployments } from "./deployments";

/** Operator-selected source. A request cannot substitute a factory or strategy. */
export function nativeYieldSource(): NativeYieldSource {
  const record = deployments();
  const release = currentRelease(record as DeploymentManifest);
  const locations = [path.join(process.cwd(), "..", "deployments"), path.join(process.cwd(), "deployments")];
  const file = locations.map(root => path.join(root, "candidates", "xoxno-testnet.source.json")).find(p => fs.existsSync(p));
  if (!file) throw new Error("XOXNO testnet source configuration is missing");
  const source = JSON.parse(fs.readFileSync(file, "utf8")) as NativeYieldSource;
  if (source.usdc !== release.usdc) throw new Error("Native yield source does not match this release's USDC");
  return source;
}
