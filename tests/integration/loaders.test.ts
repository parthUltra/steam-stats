/**
 * The committed parsed JSON must be exactly what the real parsers produce from
 * the committed HTML, and the two loaders (parsed JSON / raw HTML) must agree.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  applyTransactionLineItems,
  extractSteamIdFromGamesHtml,
  parseAccountDataHtml,
  parseGamesPlayedHtml,
  parseTransactionDetailHtml,
  type PurchaseHistoryRow,
  type PurchaseLineItem,
} from "@/lib/account-data";
import { buildDashboard } from "@/lib/analytics/dashboard";
import { loadLocalAccountData } from "@/lib/data/load-local";
import { assertNear, FIXTURE_DIR, FIXTURE_STEAM_ID, testRoot } from "../helpers";

const raw = (file: string) =>
  fs.readFileSync(path.join(FIXTURE_DIR, "samples", "account-data", file), "utf8");
const parsed = <T>(file: string): T =>
  JSON.parse(
    fs.readFileSync(path.join(FIXTURE_DIR, "samples", "parsed", file), "utf8"),
  ) as T;
/** JSON round-trip, so `undefined` fields compare like the file on disk. */
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const STALE =
  "committed parsed JSON no longer matches the parsers — if the parser change is intended, run `npm run fixture:build` and commit the result";

describe("committed parsed JSON is the parsers' output for the committed HTML", () => {
  for (const [html, json] of [
    ["licenses.html", "licenses.json"],
    ["account-spend.html", "account-spend.json"],
    ["login-history.html", "login-history.json"],
  ] as const) {
    it(`${html} → ${json}`, () => {
      assert.deepEqual(plain(parseAccountDataHtml(raw(html), html)), parsed(json), STALE);
    });
  }

  it("transactions/*.html → transaction-line-items.json", () => {
    const dir = path.join(FIXTURE_DIR, "samples", "account-data", "transactions");
    const fromHtml: Record<string, PurchaseLineItem[]> = {};
    for (const f of fs.readdirSync(dir).sort()) {
      fromHtml[f.replace(/\.html$/, "")] = parseTransactionDetailHtml(
        fs.readFileSync(path.join(dir, f), "utf8"),
      );
    }
    assert.deepEqual(plain(fromHtml), parsed("transaction-line-items.json"));
  });

  it("purchase-history.html (+ line items) → purchase-history.json", () => {
    const result = parseAccountDataHtml(
      raw("purchase-history.html"),
      "purchase-history.html",
    );
    assert.equal(result.kind, "purchase-history");
    const rows = applyTransactionLineItems(
      result.rows as PurchaseHistoryRow[],
      parsed<Record<string, PurchaseLineItem[]>>("transaction-line-items.json"),
    );
    assert.deepEqual(
      plain({ ...result, rows }),
      parsed("purchase-history.json"),
      STALE,
    );
  });

  it("games-all.html → games-played.json (ids, names, minutes, last played)", () => {
    const html = raw("games-all.html");
    assert.equal(extractSteamIdFromGamesHtml(html), FIXTURE_STEAM_ID);
    const pick = (g: {
      appId: number;
      name: string;
      minutesForever: number | null;
      hoursForever: number;
      hours2Weeks: number | null;
      lastPlayedAt: number | null;
    }) => ({
      appId: g.appId,
      name: g.name,
      minutesForever: g.minutesForever,
      hoursForever: g.hoursForever,
      hours2Weeks: g.hours2Weeks,
      lastPlayedAt: g.lastPlayedAt,
    });
    const byId = <T extends { appId: number }>(a: T, b: T) => a.appId - b.appId;
    const fromHtml = parseGamesPlayedHtml(html).map(pick).sort(byId);
    const committed = parsed<{ games: Parameters<typeof pick>[0][] }>(
      "games-played.json",
    )
      .games.map(pick)
      .sort(byId);
    assert.deepEqual(fromHtml, committed);
  });
});

/** Run `fn` with samples/parsed hidden, so the loader falls back to raw HTML. */
async function withRawHtmlOnly<T>(fn: () => Promise<T>): Promise<T> {
  const parsedDir = path.join(testRoot(), "samples", "parsed");
  const hidden = path.join(testRoot(), "samples", "parsed.hidden");
  fs.renameSync(parsedDir, hidden);
  try {
    return await fn();
  } finally {
    fs.renameSync(hidden, parsedDir);
  }
}

describe("both loaders agree", () => {
  it("raw-HTML loader reads the same rows as the parsed-JSON loader", async () => {
    const viaJson = await loadLocalAccountData();
    assert.equal(viaJson.source, "parsed-json");
    const viaHtml = await withRawHtmlOnly(loadLocalAccountData);
    assert.equal(viaHtml.source, "raw-html");
    assert.equal(viaHtml.steamId, viaJson.steamId);
    assert.equal(viaHtml.purchases.length, viaJson.purchases.length);
    assert.deepEqual(viaHtml.licenses, viaJson.licenses);
    assert.deepEqual(viaHtml.accountSpend, viaJson.accountSpend);
    assert.deepEqual(viaHtml.loginHistory, viaJson.loginHistory);
    assert.equal(viaHtml.playedGames.length, viaJson.playedGames.length);
  });

  it("totals that need no per-item detail are identical through both loaders", async () => {
    const dashJson = await buildDashboard();
    const dashHtml = await withRawHtmlOnly(buildDashboard);
    for (const key of ["walletTopUps", "marketSpend"] as const) {
      assertNear(dashHtml.spending[key], dashJson.spending[key], `spending.${key}`);
    }
    assertNear(
      dashHtml.playtime.totalHours,
      dashJson.playtime.totalHours,
      "playtime.totalHours",
    );
    assert.equal(dashHtml.playtime.gamesPlayed, dashJson.playtime.gamesPlayed);
    assert.equal(dashHtml.meta.storeCountry, dashJson.meta.storeCountry);
    assert.equal(dashHtml.meta.purchaseRows, dashJson.meta.purchaseRows);
  });

  it("raw-HTML loader applies samples/account-data/transactions/*.html, so spend totals match the parsed-JSON loader [N2]", async () => {
    const dashJson = await buildDashboard();
    const dashHtml = await withRawHtmlOnly(buildDashboard);
    for (const key of ["netSpent", "giftSpend", "refundedTotal", "purchaseCount"] as const) {
      assertNear(dashHtml.spending[key], dashJson.spending[key], `spending.${key}`);
    }
  });
});
