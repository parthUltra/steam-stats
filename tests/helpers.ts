/** Shared by the node:test gates (integration; the security lane may import it too). */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const REPO = process.cwd();
export const FIXTURE_DIR = path.join(REPO, "tests", "fixtures", "library-a");

export const CANARIES = ["CANARY-ITAD-KEY-000000000000", "CANARY-STEAM-TOKEN"];
export const FIXTURE_STEAM_ID = "76561197960265728";

/** The throwaway data root tests/setup.ts created for this process. */
export function testRoot(): string {
  const root = process.env.STEAM_STATS_ROOT;
  assert.ok(root, "STEAM_STATS_ROOT is not set — run through tests/setup.ts");
  return root;
}

export function readExpected<T = Record<string, unknown>>(): T {
  return JSON.parse(
    fs.readFileSync(path.join(FIXTURE_DIR, "expected.json"), "utf8"),
  ) as T;
}

/** Every URL the fetch tripwire saw in this process (query strings removed). */
export function fetchLog(): string[] {
  return globalThis.__steamStatsFetchLog ?? [];
}

export function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}

/** relative path → sha256, for "nothing on disk changed" assertions. */
export function snapshotTree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const file of listFiles(dir)) {
    out[path.relative(dir, file)] = createHash("sha256")
      .update(fs.readFileSync(file))
      .digest("hex");
  }
  return out;
}

export function near(actual: number, expected: number, eps = 1e-6): boolean {
  return Math.abs(actual - expected) <= eps;
}

export function assertNear(
  actual: number | null | undefined,
  expected: number,
  message: string,
  eps = 1e-6,
) {
  assert.ok(
    typeof actual === "number" && near(actual, expected, eps),
    `${message}: expected ${expected}, got ${actual}`,
  );
}
