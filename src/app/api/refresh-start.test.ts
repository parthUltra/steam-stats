/**
 * When POST /api/refresh-prices starts a refresh — and when it must not.
 * The child process is always mocked: nothing is spawned, nothing is fetched.
 */
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it, type TestContext } from "node:test";
import { POST as postRefresh } from "@/app/api/refresh-prices/route";

const ENV = [
  "STEAM_STATS_ROOT",
  "STEAM_STATS_OFFLINE",
  "STEAM_STATS_SKIP_PRICES",
  "ISTHEREANYDEAL_API_KEY",
  "ITAD_API_KEY",
] as const;
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
let root: string;

const post = (body?: unknown) =>
  postRefresh(
    new Request("http://127.0.0.1:3000/api/refresh-prices", {
      method: "POST",
      headers: {
        host: "127.0.0.1:3000",
        origin: "http://127.0.0.1:3000",
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );

/** Replace child_process.spawn; returns the list of spawn calls. */
function mockSpawn(t: TestContext) {
  const calls: unknown[][] = [];
  t.mock.method(childProcess, "spawn", (...args: unknown[]) => {
    calls.push(args);
    const child = new EventEmitter() as EventEmitter & {
      pid?: number;
      unref: () => void;
    };
    child.pid = undefined;
    child.unref = () => undefined;
    return child;
  });
  return calls;
}

const quote = (title: string, updatedAt: string) => ({
  title,
  steamAppId: 1,
  currentInr: 500,
  lowestInr: null,
  retailInr: 500,
  lowestUsd: null,
  currentUsd: null,
  retailUsd: null,
  onSale: false,
  source: "steam",
  updatedAt,
  itadCheckedAt: null,
  currency: "INR",
  isFree: false,
});

async function writeCache(updatedAt: string) {
  await fs.writeFile(
    path.join(root, "data", "price-cache.json"),
    JSON.stringify({
      version: 2,
      updatedAt,
      country: "IN",
      currency: "INR",
      quotes: { "example game": quote("Example Game", updatedAt) },
    }),
  );
}

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "refresh-start-test-"));
  await fs.mkdir(path.join(root, "samples", "parsed"), { recursive: true });
  await fs.mkdir(path.join(root, "data"), { recursive: true });
  const money = { raw: "₹ 100", amount: 100, currencyHint: "INR" };
  await fs.writeFile(
    path.join(root, "samples", "parsed", "purchase-history.json"),
    JSON.stringify({
      kind: "purchase-history",
      status: "ok",
      rows: [
        {
          dateText: "3 Mar, 2026",
          items: ["Example Game"],
          lineItems: [],
          type: "Purchase",
          paymentMethods: ["Visa"],
          isGift: false,
          price: money,
          total: money,
          refunded: false,
        },
      ],
    }),
  );
});
beforeEach(async () => {
  await fs.rm(path.join(root, ".price-refresh"), { recursive: true, force: true });
  process.env.STEAM_STATS_ROOT = root;
  delete process.env.STEAM_STATS_OFFLINE;
  delete process.env.STEAM_STATS_SKIP_PRICES;
  delete process.env.ISTHEREANYDEAL_API_KEY;
  delete process.env.ITAD_API_KEY;
});
after(async () => {
  for (const key of ENV) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  await fs.rm(root, { recursive: true, force: true });
});

const STALE = "2026-01-01T00:00:00.000Z";

describe("POST /api/refresh-prices", () => {
  it("without an ITAD key, Steam prices fetched this week count as fresh: nothing starts", async (t) => {
    const spawned = mockSpawn(t);
    await writeCache(new Date().toISOString());
    const body = (await (await post()).json()) as Record<string, unknown>;
    assert.equal(body.started, false);
    assert.equal(body.weekFresh, true);
    assert.equal(body.latest, 1);
    assert.equal(spawned.length, 0);
  });

  it("without an ITAD key, week-old Steam prices do start a refresh", async (t) => {
    const spawned = mockSpawn(t);
    await writeCache(STALE);
    const body = (await (await post()).json()) as Record<string, unknown>;
    assert.equal(body.started, true);
    assert.equal(spawned.length, 1);
  });

  it("STEAM_STATS_SKIP_PRICES=1 skips the automatic refresh", async (t) => {
    const spawned = mockSpawn(t);
    process.env.STEAM_STATS_SKIP_PRICES = "1";
    await writeCache(STALE);
    const res = await post();
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.ok, true);
    assert.equal(body.started, false);
    assert.equal(body.skipped, true);
    assert.equal(body.skipPrices, true);
    assert.equal(spawned.length, 0);
    await assert.rejects(fs.access(path.join(root, ".price-refresh")));
  });

  it("…but an explicit refresh still runs", async (t) => {
    const spawned = mockSpawn(t);
    process.env.STEAM_STATS_SKIP_PRICES = "1";
    await writeCache(STALE);
    const body = (await (await post({ force: true })).json()) as Record<string, unknown>;
    assert.equal(body.started, true);
    assert.equal(spawned.length, 1);
  });
});
