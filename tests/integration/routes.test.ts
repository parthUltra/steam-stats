/**
 * Route handlers are plain functions; call them directly — no server needed.
 * Only read paths are exercised here; the mutating routes belong to the
 * security gate (tests/security).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GET as getDashboard } from "@/app/api/dashboard/route";
import { GET as getGifts } from "@/app/api/gifts-received/route";
import { GET as getItadKey } from "@/app/api/itad-key/route";
import { GET as getRefresh } from "@/app/api/refresh-prices/route";
import type { DashboardPayload } from "@/lib/analytics/contracts";
import {
  CANARIES,
  fetchLog,
  readExpected,
  snapshotTree,
  testRoot,
} from "../helpers";

const exp = readExpected<{
  playtime: { totalHours: number };
  meta: { purchaseRows: number };
}>();

async function bodyOf(res: Response): Promise<{ text: string; json: unknown }> {
  const text = await res.text();
  return { text, json: JSON.parse(text) };
}

function assertNoCanary(text: string, route: string) {
  for (const canary of CANARIES) {
    assert.ok(!text.includes(canary), `${route} leaks ${canary}`);
  }
}

describe("GET route handlers on the fixture", () => {
  it("GET /api/dashboard → 200 with the full payload contract", async () => {
    const res = await getDashboard();
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /application\/json/);
    const { text, json } = await bodyOf(res);
    const d = json as DashboardPayload;
    assert.deepEqual(Object.keys(d).sort(), [
      "artwork",
      "costPerHour",
      "meta",
      "playtime",
      "recentPurchases",
      "spending",
      "stats",
      "valuation",
    ]);
    assert.equal(d.meta.purchaseRows, exp.meta.purchaseRows);
    assert.ok(Math.abs(d.playtime.totalHours - exp.playtime.totalHours) < 1e-6);
    assert.equal(d.recentPurchases.length, 15);
    assertNoCanary(text, "/api/dashboard");
  });

  it("GET /api/refresh-prices → idle status, nothing running", async () => {
    const res = await getRefresh();
    assert.equal(res.status, 200);
    const { text, json } = await bodyOf(res);
    const b = json as {
      running: boolean;
      priceCacheUpdatedAt: string | null;
      ttlMs: number;
      status: Record<string, unknown>;
    };
    assert.equal(b.running, false);
    assert.equal(b.priceCacheUpdatedAt, "2026-10-14T06:00:00.000Z");
    assert.ok(b.ttlMs > 0);
    assert.ok(!("pid" in b.status), "process id must stay server-side");
    assertNoCanary(text, "/api/refresh-prices");
  });

  it("GET /api/gifts-received → the one e-mail gift, sync not running", async () => {
    const res = await getGifts();
    assert.equal(res.status, 200);
    const { text, json } = await bodyOf(res);
    const b = json as {
      gifts: { title: string; fromPersona?: string }[];
      sync: { running: boolean };
    };
    assert.deepEqual(
      b.gifts.map((g) => [g.title, g.fromPersona]),
      [["Pocket Cartographer", "juniper_fox"]],
    );
    assert.equal(b.sync.running, false);
    assertNoCanary(text, "/api/gifts-received");
  });

  it("GET /api/itad-key → says a key is stored, never returns it", async () => {
    const res = await getItadKey();
    assert.equal(res.status, 200);
    const { text, json } = await bodyOf(res);
    assert.equal((json as { connected: boolean }).connected, true);
    assertNoCanary(text, "/api/itad-key");
  });

  it("the four GETs wrote nothing and fetched nothing", async () => {
    const before = snapshotTree(testRoot());
    await getDashboard();
    await getRefresh();
    await getGifts();
    await getItadKey();
    assert.deepEqual(snapshotTree(testRoot()), before);
    assert.deepEqual(fetchLog(), []);
  });
});
