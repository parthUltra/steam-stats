/**
 * Loaded before every node:test file of the integration and security gates:
 *
 *   tsx --test --import ./tests/setup.ts "tests/integration/**\/*.test.ts"
 *
 * Makes the run hermetic:
 *  - STEAM_STATS_ROOT → a throwaway copy of tests/fixtures/library-a
 *    (an already-set root is respected and left alone)
 *  - STEAM_STATS_OFFLINE=1, TZ=UTC, no API keys from the developer's shell
 *  - global fetch replaced by a tripwire that records every call and throws
 *    for anything that is not loopback
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const FIXTURE = path.resolve("tests", "fixtures", "library-a");

if (!process.env.STEAM_STATS_ROOT) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "steam-stats-test-"));
  fs.cpSync(FIXTURE, root, { recursive: true });
  process.env.STEAM_STATS_ROOT = root;
  process.on("exit", () => {
    fs.rmSync(root, { recursive: true, force: true });
  });
}

process.env.STEAM_STATS_OFFLINE = "1";
process.env.TZ = "UTC";
process.env.STEAM_API_KEY = "";
process.env.ISTHEREANYDEAL_API_KEY = "";
process.env.ITAD_API_KEY = "";

declare global {
  var __steamStatsFetchLog: string[] | undefined;
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
const fetchLog: string[] = (globalThis.__steamStatsFetchLog ??= []);
const realFetch = globalThis.fetch;

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const raw =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  let host = "";
  try {
    host = new URL(raw).hostname;
  } catch {
    // unparseable → blocked below
  }
  fetchLog.push(raw.split("?")[0]);
  if (!LOOPBACK.has(host)) {
    throw new Error(
      `offline tripwire: blocked outbound fetch to ${host || "(unparseable url)"}`,
    );
  }
  return realFetch(input, init);
}) as typeof fetch;
