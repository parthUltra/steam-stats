import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { PlayedGame } from "../account-data";
import {
  computeDashboard,
  loadDashboardInputs,
  playtimeSourceFromSnapshot,
  type DashboardInputs,
} from "./dashboard";

const GIFT_URL = "https://store.steampowered.com/account/ackgift/CANARY?redeemer=x";

function played(appId: number, name: string): PlayedGame {
  return {
    appId,
    name,
    hoursForever: 1,
    hours2Weeks: null,
    lastPlayedText: null,
    lastPlayedAt: null,
    minutesForever: 60,
  };
}

function inputs(over: Partial<DashboardInputs> = {}): DashboardInputs {
  return {
    bundle: {
      purchases: [],
      licenses: [],
      accountSpend: [],
      loginHistory: [],
      playedGames: [played(1, "One"), played(2, "Two")],
      playedFetchedAt: "2026-08-17T12:36:48.413Z",
      steamId: null,
      source: "parsed-json",
      // cast: the data lane may add bookkeeping fields this test does not read
    } as DashboardInputs["bundle"],
    priceCache: { updatedAt: "", country: "IN", currency: "INR", quotes: {} },
    region: { country: "IN", currency: "INR", source: "cache" },
    receivedGifts: {
      updatedAt: "",
      gifts: [
        {
          title: "PEAK",
          fromPersona: "friend-one",
          giftUrl: GIFT_URL,
          source: "gmail",
          importedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    },
    dlcParents: new Map(),
    artworkCache: {},
    hasItadApiKey: false,
    ...over,
  };
}

describe("computeDashboard — gift redemption links", () => {
  it("never puts a gift URL in the payload", () => {
    const payload = computeDashboard(inputs());
    assert.equal(payload.meta.mailGifts.length, 1);
    assert.equal(payload.meta.mailGifts[0].title, "PEAK");
    assert.equal(payload.meta.mailGifts[0].giftUrl, null);
    const json = JSON.stringify(payload);
    assert.equal(json.includes("ackgift"), false);
    assert.equal(json.includes("CANARY"), false);
    // no giftUrl key anywhere carries a value
    assert.equal(/"giftUrl":(?!null)/.test(json), false);
  });
});

describe("playtime source", () => {
  it("maps the source recorded in the snapshot file", () => {
    assert.equal(playtimeSourceFromSnapshot("steam-session-api"), "steam-api");
    assert.equal(playtimeSourceFromSnapshot("steam-api"), "steam-api");
    assert.equal(playtimeSourceFromSnapshot("merged"), "merged");
    assert.equal(playtimeSourceFromSnapshot("account-data-html"), "account-data-html");
    // nothing recorded (raw HTML fallback, legacy file) → the partial page
    assert.equal(playtimeSourceFromSnapshot(null), "account-data-html");
    assert.equal(playtimeSourceFromSnapshot(undefined), "account-data-html");
  });

  it("a complete 2-game API library is not called a partial snapshot", () => {
    const base = inputs();
    const payload = computeDashboard({
      ...base,
      bundle: { ...base.bundle, playedSource: "steam-session-api" },
    });
    assert.equal(payload.playtime.source, "steam-api");
  });

  it("a 60-game HTML scrape is still reported as the Account Data page", () => {
    const many = Array.from({ length: 60 }, (_, i) => played(i + 1, `Game ${i + 1}`));
    const base = inputs();
    const payload = computeDashboard({
      ...base,
      bundle: {
        ...base.bundle,
        playedGames: many,
        playedSource: "account-data-html",
      },
    });
    assert.equal(payload.playtime.source, "account-data-html");
  });
});

describe("computeDashboard — data provenance in meta", () => {
  const licence = (item: string, method = "Steam Store", dateText = "3 Mar, 2026") => ({
    dateText,
    item,
    acquisitionMethod: method,
    packageId: null,
    removableComplimentary: false,
  });

  it("passes source status (with licence pagination) and fetch times through", () => {
    const base = inputs();
    const sourceStatus = {
      purchases: { status: "ok" as const, rows: 0 },
      licenses: {
        status: "partial" as const,
        rows: 100,
        detail: "showing 1-100 of 453",
        pagination: { shown: 100, total: 453 },
      },
      accountSpend: { status: "login-required" as const, rows: 0 },
      loginHistory: { status: "missing" as const, rows: 0 },
    };
    const payload = computeDashboard({
      ...base,
      bundle: {
        ...base.bundle,
        sourceStatus,
        accountSpendFetchedAt: "2026-10-01T08:00:00.000Z",
      },
    });
    assert.deepEqual(payload.meta.sourceStatus, sourceStatus);
    assert.equal(payload.meta.playedFetchedAt, "2026-08-17T12:36:48.413Z");
    assert.equal(payload.meta.accountSpendFetchedAt, "2026-10-01T08:00:00.000Z");
  });

  it("defaults: no status, no issues", () => {
    const payload = computeDashboard(inputs());
    assert.equal(payload.meta.sourceStatus, null);
    assert.equal(payload.meta.accountSpendFetchedAt, null);
    assert.deepEqual(payload.meta.dataIssues, []);
  });

  it("flags parsed files that predate status tracking", () => {
    const base = inputs();
    const status = (s: "ok" | "unknown") => ({
      purchases: { status: s, rows: 3 },
      licenses: { status: "ok" as const, rows: 1 },
      accountSpend: { status: "missing" as const, rows: 0 },
      loginHistory: { status: "missing" as const, rows: 0 },
    });
    const withStatus = (s: "ok" | "unknown") =>
      computeDashboard({ ...base, bundle: { ...base.bundle, sourceStatus: status(s) } });
    assert.equal(withStatus("unknown").meta.needsReparse, true);
    assert.equal(withStatus("ok").meta.needsReparse, false);
    assert.equal(computeDashboard(base).meta.needsReparse, false);
  });

  it("no longer reports a Steam Web API key: nothing reads one", () => {
    const savedKey = process.env.STEAM_API_KEY;
    process.env.STEAM_API_KEY = "0123456789ABCDEF0123456789ABCDEF";
    try {
      assert.equal(computeDashboard(inputs()).meta.hasSteamApiKey, false);
    } finally {
      if (savedKey === undefined) delete process.env.STEAM_API_KEY;
      else process.env.STEAM_API_KEY = savedKey;
    }
  });

  it("surfaces data issues handed in by the loader", () => {
    const issue = {
      code: "price-cache-unreadable" as const,
      file: "data/price-cache.json",
      backup: "data/price-cache.json.bak",
      message: "x",
    };
    const payload = computeDashboard(inputs({ dataIssues: [issue] }));
    assert.deepEqual(payload.meta.dataIssues, [issue]);
  });

  it("counts owned titles with no licence, purchase or gift record", () => {
    const base = inputs();
    const payload = computeDashboard({
      ...base,
      bundle: {
        ...base.bundle,
        // One, Two (from inputs) + Three; only One has a licence, PEAK is a mail gift
        playedGames: [
          played(1, "One"),
          played(2, "Two"),
          played(3, "Three"),
          played(4, "PEAK"),
          { ...played(5, "Family Game"), fromFamily: true },
        ],
        licenses: [licence("One")],
      },
    });
    assert.equal(payload.meta.ownedWithoutRecordCount, 2);
  });

  it("gives the growth stat the dates of received gifts", () => {
    const base = inputs();
    const payload = computeDashboard({
      ...base,
      bundle: {
        ...base.bundle,
        playedGames: [played(1, "PEAK"), played(2, "Marrow Deep")],
        licenses: [licence("Marrow Deep", "Gift/Guest Pass", "5 Mar, 2024")],
      },
      receivedGifts: {
        updatedAt: "",
        gifts: [
          {
            title: "PEAK",
            receivedAt: "2025-07-01T10:00:00.000Z",
            source: "gmail",
            importedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
    });
    // PEAK is dated only by its gift e-mail; Marrow Deep also by its licence
    assert.equal(payload.stats.libraryGrowth?.datedCount, 2);
    const months = payload.stats.libraryGrowth!.points.filter((p) => p.added > 0);
    assert.deepEqual(
      months.map((p) => p.month),
      ["2024-03", "2025-07"],
    );
  });
});

describe("loadDashboardInputs — unreadable caches", () => {
  const savedRoot = process.env.STEAM_STATS_ROOT;

  async function withRoot(fn: (root: string) => Promise<void>) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dashboard-test-"));
    process.env.STEAM_STATS_ROOT = root;
    try {
      await fs.mkdir(path.join(root, "samples", "parsed"), { recursive: true });
      await fs.mkdir(path.join(root, "data"), { recursive: true });
      await fs.writeFile(
        path.join(root, "samples", "parsed", "purchase-history.json"),
        JSON.stringify({ kind: "purchase-history", status: "ok", rows: [] }),
      );
      await fn(root);
    } finally {
      if (savedRoot === undefined) delete process.env.STEAM_STATS_ROOT;
      else process.env.STEAM_STATS_ROOT = savedRoot;
      await fs.rm(root, { recursive: true, force: true });
    }
  }

  it("a corrupt price cache becomes a typed issue; the file is left untouched", async () => {
    await withRoot(async (root) => {
      const file = path.join(root, "data", "price-cache.json");
      const bak = `${file}.bak`;
      const garbage = '{"updatedAt":"2026-08-17","quotes":{"cel';
      await fs.writeFile(file, garbage);
      await fs.writeFile(bak, "{}");

      const loaded = await loadDashboardInputs();
      assert.deepEqual(loaded.priceCache.quotes, {});
      assert.equal(loaded.dataIssues?.length, 1);
      const issue = loaded.dataIssues![0];
      assert.equal(issue.code, "price-cache-unreadable");
      assert.equal(issue.file, path.join("data", "price-cache.json"));
      assert.equal(issue.backup, path.join("data", "price-cache.json.bak"));
      assert.match(issue.message, /price cache unreadable — a backup exists at /);
      // no absolute path leaves the server
      assert.equal(JSON.stringify(loaded.dataIssues).includes(root), false);

      const payload = computeDashboard(loaded);
      assert.equal(payload.meta.dataIssues[0].code, "price-cache-unreadable");
      assert.equal(await fs.readFile(file, "utf8"), garbage);
      assert.deepEqual((await fs.readdir(path.join(root, "data"))).sort(), [
        "price-cache.json",
        "price-cache.json.bak",
      ]);
    });
  });

  it("says so when there is no backup, and handles a corrupt gifts file too", async () => {
    await withRoot(async (root) => {
      await fs.writeFile(path.join(root, "data", "price-cache.json"), "not json");
      await fs.writeFile(path.join(root, "data", "gifts-received.json"), "[1,");
      const loaded = await loadDashboardInputs();
      assert.deepEqual(
        loaded.dataIssues?.map((i) => [i.code, i.backup]).sort(),
        [
          ["price-cache-unreadable", null],
          ["received-gifts-unreadable", null],
        ],
      );
      assert.match(loaded.dataIssues![0].message, /no backup/);
      assert.deepEqual(loaded.receivedGifts.gifts, []);
    });
  });

  it("no issues for missing or healthy files", async () => {
    await withRoot(async () => {
      assert.deepEqual((await loadDashboardInputs()).dataIssues, []);
    });
  });
});
