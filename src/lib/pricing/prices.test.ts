import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, afterEach, beforeEach, describe, it } from "node:test";
import { CorruptJsonFileError } from "@/lib/data/json-store";
import {
  IS_FREE_BACKFILL_PER_RUN,
  ItadRateLimitError,
  PRICE_CACHE_VERSION,
  countLatestQuotes,
  isQuoteLatestStoreLow,
  isStoreLowsWeekFresh,
  pickOldestTitles,
  loadPriceCache,
  migratePriceCache,
  refreshPricesForTitles,
  resolveAndApplyStoreRegion,
  savePriceCache,
  type GamePriceQuote,
  type PriceCache,
} from "./prices";

const realFetch = globalThis.fetch;
const savedEnv = { ...process.env };
let root: string;
let cacheFile: string;

/** A v1 on-disk quote, exactly the shape older versions wrote. */
function v1Quote(over: Partial<GamePriceQuote> & { title: string }): GamePriceQuote {
  return {
    steamAppId: 1,
    itadId: null,
    lowestUsd: null,
    currentUsd: null,
    currentInr: null,
    lowestInr: null,
    retailInr: null,
    retailUsd: null,
    onSale: false,
    source: "steam",
    updatedAt: "2026-01-01T00:00:00.000Z",
    itadCheckedAt: null,
    ...over,
  };
}

async function writeCache(cache: unknown) {
  await fs.mkdir(path.dirname(cacheFile), { recursive: true });
  await fs.writeFile(cacheFile, JSON.stringify(cache, null, 2));
}

type Route = (url: URL, init?: RequestInit) => unknown | Response;

/** Stub the network: first matching path prefix answers; anything else fails the test. */
function stubFetch(routes: Record<string, Route>) {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    for (const [prefix, handler] of Object.entries(routes)) {
      if (!url.pathname.startsWith(prefix)) continue;
      const out = handler(url, init);
      if (out instanceof Response) return out;
      return new Response(JSON.stringify(out), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected request in test: ${url.pathname}`);
  }) as typeof fetch;
  return calls;
}

const account = { purchases: [], loginHistory: [] };
/** Edition-proxy lookups for unlisted titles find nothing. */
const noSearchResults = () => ({ total: 0, items: [] });

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "prices-test-"));
  cacheFile = path.join(root, "data", "price-cache.json");
  process.env.STEAM_STATS_ROOT = root;
  // The network is stubbed: do not wait out the real request limiters
  // (3 s between ITAD calls made these tests take 15 s).
  process.env.STEAM_STATS_NO_PACING = "1";
  delete process.env.STEAM_STATS_OFFLINE;
  delete process.env.ISTHEREANYDEAL_API_KEY;
  delete process.env.ITAD_API_KEY;
});
afterEach(async () => {
  globalThis.fetch = realFetch;
  await fs.rm(root, { recursive: true, force: true });
});
after(() => {
  process.env = savedEnv;
});

describe("price cache file safety", () => {
  it("treats a missing file as an empty cache", async () => {
    const cache = await loadPriceCache();
    assert.deepEqual(cache.quotes, {});
  });

  it("throws on a truncated file and never writes over it", async () => {
    const good = JSON.stringify({
      updatedAt: "2026-01-01T00:00:00.000Z",
      country: "IN",
      currency: "INR",
      quotes: { "game a": v1Quote({ title: "Game A", currentInr: 500 }) },
    });
    const truncated = good.slice(0, Math.floor(good.length / 2));
    await fs.mkdir(path.dirname(cacheFile), { recursive: true });
    await fs.writeFile(cacheFile, truncated);

    await assert.rejects(loadPriceCache(), CorruptJsonFileError);
    // The audit's data-loss path: region detection used to save an empty cache here.
    await assert.rejects(
      resolveAndApplyStoreRegion(undefined, account),
      CorruptJsonFileError,
    );
    await assert.rejects(
      savePriceCache({ updatedAt: "", quotes: {} }),
      CorruptJsonFileError,
    );
    assert.equal(await fs.readFile(cacheFile, "utf8"), truncated);
  });

  it("rejects valid JSON that is not a price cache", async () => {
    await writeCache([]);
    await assert.rejects(loadPriceCache(), CorruptJsonFileError);
  });

  it("keeps the previous file as .bak on save", async () => {
    await writeCache({
      updatedAt: "2026-01-01T00:00:00.000Z",
      currency: "INR",
      quotes: { "game a": v1Quote({ title: "Game A", currentInr: 500 }) },
    });
    const cache = await loadPriceCache();
    cache.quotes["game a"].currentInr = 400;
    await savePriceCache(cache);
    const bak = JSON.parse(await fs.readFile(`${cacheFile}.bak`, "utf8")) as PriceCache;
    assert.equal(bak.quotes["game a"].currentInr, 500);
    assert.deepEqual(
      (await fs.readdir(path.dirname(cacheFile))).sort(),
      ["price-cache.json", "price-cache.json.bak"],
    );
  });

  it(
    "creates data/ 0700 and writes the cache and its backup 0600",
    { skip: process.platform === "win32" },
    async () => {
      const mode = async (p: string) => (await fs.stat(p)).mode & 0o777;
      // an older, world-readable cache in a world-readable directory
      await fs.mkdir(path.dirname(cacheFile), { recursive: true, mode: 0o755 });
      await fs.chmod(path.dirname(cacheFile), 0o755);
      await fs.writeFile(cacheFile, JSON.stringify({ updatedAt: "", quotes: {} }), {
        mode: 0o644,
      });
      await savePriceCache(await loadPriceCache());
      assert.equal(await mode(path.dirname(cacheFile)), 0o700);
      assert.equal(await mode(cacheFile), 0o600);
      assert.equal(await mode(`${cacheFile}.bak`), 0o600);
    },
  );

  it("merges two writers that each hold a stale in-memory copy", async () => {
    await writeCache({
      updatedAt: "2026-01-01T00:00:00.000Z",
      currency: "INR",
      quotes: {
        shared: v1Quote({ title: "Shared", currentInr: 100 }),
        untouched: v1Quote({ title: "Untouched", currentInr: 7 }),
      },
    });
    // Two processes load the same file, then work for a while.
    const script = await loadPriceCache();
    const server = await loadPriceCache();

    script.quotes["from script"] = v1Quote({
      title: "From Script",
      currentInr: 1,
      updatedAt: "2026-02-01T00:00:00.000Z",
    });
    script.quotes.shared = {
      ...script.quotes.shared,
      currentInr: 200,
      updatedAt: "2026-02-01T00:00:00.000Z",
    };
    server.quotes["from server"] = v1Quote({
      title: "From Server",
      currentInr: 2,
      updatedAt: "2026-02-02T00:00:00.000Z",
    });

    // Interleaved saves, the stale server copy last.
    await Promise.all([savePriceCache(script), savePriceCache(server)]);
    await savePriceCache(server);

    const disk = await loadPriceCache();
    assert.deepEqual(Object.keys(disk.quotes).sort(), [
      "from script",
      "from server",
      "shared",
      "untouched",
    ]);
    // the newer quote wins, not the last writer
    assert.equal(disk.quotes.shared.currentInr, 200);
  });
});

describe("migratePriceCache (v1 → v2)", () => {
  const v1 = (): PriceCache => ({
    updatedAt: "2026-01-01T00:00:00.000Z",
    country: "IN",
    currency: "INR",
    quotes: {
      // store-search price (local currency) written into the USD fields
      mislabelled: v1Quote({
        title: "Mislabelled",
        itadId: "itad-1",
        currentUsd: 690,
        retailUsd: 690,
        currentInr: 690,
        retailInr: 690,
        lowestInr: 345,
      }),
      // local price missing: 690 "USD" used to be multiplied by the ratio
      "missing local": v1Quote({
        title: "Missing Local",
        currentUsd: 690,
        retailUsd: 690,
        currentInr: null,
        retailInr: 690,
      }),
      // a real US-store quote
      genuine: v1Quote({
        title: "Genuine",
        currentUsd: 9.99,
        retailUsd: 19.99,
        lowestUsd: 4.99,
        currentInr: 450,
        retailInr: 900,
        source: "steam+itad+cheapshark" as GamePriceQuote["source"],
      }),
    },
  });

  it("labels every quote with its currency and keeps all quotes and ids", () => {
    const out = migratePriceCache(v1());
    assert.equal(out.version, PRICE_CACHE_VERSION);
    assert.equal(Object.keys(out.quotes).length, 3);
    for (const q of Object.values(out.quotes)) assert.equal(q.currency, "INR");
    assert.equal(out.quotes.mislabelled.itadId, "itad-1");
    assert.equal(out.quotes.mislabelled.lowestInr, 345);
    assert.equal(out.quotes.mislabelled.currentInr, 690);
  });

  it("never leaves a local-currency amount in a USD field", () => {
    const out = migratePriceCache(v1());
    for (const q of Object.values(out.quotes)) {
      assert.equal(q.currentUsd, null);
      assert.equal(q.retailUsd, null);
      assert.equal(q.lowestUsd, null);
    }
    assert.equal(out.quotes.mislabelled.usd ?? null, null);
    // unpriced, not 690 × ratio
    assert.equal(out.quotes["missing local"].currentInr, null);
    assert.equal(out.quotes["missing local"].usd ?? null, null);
  });

  it("keeps a real USD quote as a labelled reference", () => {
    const out = migratePriceCache(v1());
    assert.deepEqual(out.quotes.genuine.usd, {
      current: 9.99,
      retail: 19.99,
      lowest: 4.99,
    });
    assert.equal(out.quotes.genuine.source, "steam+itad");
  });

  it("is idempotent and loadPriceCache applies it without rewriting the file", async () => {
    const once = migratePriceCache(v1());
    const twice = migratePriceCache(structuredClone(once));
    assert.deepEqual(twice, once);

    await writeCache(v1());
    const before = await fs.readFile(cacheFile, "utf8");
    const loaded = await loadPriceCache();
    assert.equal(loaded.quotes.genuine.usd?.current, 9.99);
    assert.equal(await fs.readFile(cacheFile, "utf8"), before);
  });

  it("fills local gaps from the USD fields when the store currency is USD", () => {
    const out = migratePriceCache({
      updatedAt: "",
      country: "US",
      currency: "USD",
      quotes: {
        a: v1Quote({ title: "A", currentUsd: 9.99, retailUsd: 19.99 }),
      },
    });
    assert.equal(out.quotes.a.currentInr, 9.99);
    assert.equal(out.quotes.a.retailInr, 19.99);
    assert.equal(out.quotes.a.currency, "USD");
  });
});

describe("refreshPricesForTitles without an ITAD key", () => {
  const seed = () =>
    writeCache({
      version: 2,
      updatedAt: "2026-01-01T00:00:00.000Z",
      country: "IN",
      currency: "INR",
      quotes: {
        "game a": {
          ...v1Quote({
            title: "Game A",
            steamAppId: 111,
            currentInr: 500,
            retailInr: 500,
            lowestInr: 250,
            source: "steam+itad",
          }),
          currency: "INR",
        },
      },
    });

  it("re-reads the Steam price instead of only stamping the cache", async () => {
    await seed();
    const calls = stubFetch({
      "/api/appdetails": () => ({
        "111": {
          success: true,
          data: {
            is_free: false,
            price_overview: { currency: "INR", initial: 50000, final: 30000 },
          },
        },
      }),
    });
    const cache = await refreshPricesForTitles(["Game A"], { force: true });
    const q = cache.quotes["game a"];
    assert.deepEqual(calls, ["/api/appdetails"]);
    assert.equal(q.currentInr, 300);
    assert.equal(q.retailInr, 500);
    assert.equal(q.onSale, true);
    assert.equal(q.currency, "INR");
    assert.equal(q.currentUsd, null);
    assert.equal(q.isFree, false);
    // the old low is kept but must not look freshly checked
    assert.equal(q.lowestInr, 250);
    assert.equal(isQuoteLatestStoreLow(q), false);
  });

  it("clears a borrowed price once Steam says the app is free", async () => {
    await seed();
    stubFetch({
      "/api/appdetails": () => ({ "111": { success: true, data: { is_free: true } } }),
    });
    const q = (await refreshPricesForTitles(["Game A"], { force: true })).quotes[
      "game a"
    ];
    assert.equal(q.isFree, true);
    assert.equal(q.currentInr, null);
    assert.equal(q.lowestInr, null);
    assert.equal(q.retailInr, null);
    assert.equal(q.steamAppId, 111);
  });

  it("does not stamp the cache or the quote when Steam is unreachable", async () => {
    await seed();
    stubFetch({
      "/api/appdetails": () => new Response("nope", { status: 503 }),
    });
    const cache = await refreshPricesForTitles(["Game A"], { force: true });
    assert.equal(cache.updatedAt, "2026-01-01T00:00:00.000Z");
    assert.equal(cache.quotes["game a"].updatedAt, "2026-01-01T00:00:00.000Z");
    assert.equal(cache.quotes["game a"].currentInr, 500);
    assert.equal(cache.quotes["game a"].steamAppId, 111);
  });

  it("stores a price in another currency as unpriced, not as local", async () => {
    await seed();
    stubFetch({
      "/api/appdetails": () => ({
        "111": {
          success: true,
          data: { price_overview: { currency: "USD", initial: 1999, final: 999 } },
        },
      }),
    });
    const q = (await refreshPricesForTitles(["Game A"], { force: true })).quotes[
      "game a"
    ];
    assert.equal(q.currentInr, null);
    assert.equal(q.retailInr, null);
    assert.deepEqual(q.usd, { current: 9.99, retail: 19.99 });
  });

  it("resolves a new title with local-currency fields only", async () => {
    await seed();
    stubFetch({
      "/api/storesearch": () => ({
        total: 2,
        items: [
          { type: "app", name: "Something Else", id: 5 },
          {
            type: "app",
            name: "Game B",
            id: 222,
            price: { currency: "INR", initial: 69000, final: 69000 },
          },
        ],
      }),
      "/api/appdetails": () => ({
        "222": {
          success: true,
          data: { price_overview: { currency: "INR", initial: 69000, final: 69000 } },
        },
      }),
    });
    const q = (await refreshPricesForTitles(["Game B"])).quotes["game b"];
    assert.equal(q.steamAppId, 222);
    assert.equal(q.currentInr, 690);
    assert.equal(q.currency, "INR");
    assert.equal(q.currentUsd, null);
    assert.equal(q.retailUsd, null);
  });

  it("leaves a title unresolved rather than taking the first search result", async () => {
    await seed();
    stubFetch({
      "/api/storesearch": () => ({
        total: 1,
        items: [{ type: "app", name: "Completely Different", id: 5 }],
      }),
    });
    const q = (await refreshPricesForTitles(["Game B"])).quotes["game b"];
    assert.equal(q.steamAppId, null);
    assert.equal(q.source, "unresolved");
  });

  it("keeps a resolved quote when the store search request fails", async () => {
    await writeCache({
      version: 2,
      updatedAt: "2026-01-01T00:00:00.000Z",
      country: "IN",
      currency: "INR",
      quotes: {},
    });
    stubFetch({
      "/api/storesearch": () => new Response("nope", { status: 500 }),
    });
    const cache = await refreshPricesForTitles(["Game B"]);
    // nothing learned → no "unresolved" verdict and no fresh stamp
    assert.equal(cache.quotes["game b"], undefined);
    assert.equal(cache.updatedAt, "2026-01-01T00:00:00.000Z");
  });
});

describe("refreshPricesForTitles with an ITAD key", () => {
  const ITAD_A = "018d937f-0000-7000-8000-00000000000a";
  const ITAD_B = "018d937f-0000-7000-8000-00000000000b";
  const old = "2026-01-01T00:00:00.000Z";

  const seed = () =>
    writeCache({
      version: 2,
      updatedAt: old,
      country: "IN",
      currency: "INR",
      quotes: {
        "game a": {
          ...v1Quote({
            title: "Game A",
            steamAppId: 111,
            itadId: ITAD_A,
            currentInr: 500,
            retailInr: 500,
            updatedAt: old,
          }),
          currency: "INR",
          isFree: false,
        },
        "game b": {
          ...v1Quote({
            title: "Game B",
            steamAppId: 222,
            itadId: ITAD_B,
            currentInr: 800,
            retailInr: 800,
            updatedAt: old,
          }),
          currency: "INR",
          isFree: false,
        },
      },
    });

  beforeEach(() => {
    process.env.ITAD_API_KEY = "test-key-0123456789abcdef";
  });

  it("does not stamp the batch as checked when the ITAD request fails", async () => {
    await seed();
    stubFetch({
      "/games/prices/v3": () => new Response("upstream", { status: 502 }),
      "/api/storesearch": noSearchResults,
    });
    const cache = await refreshPricesForTitles(["Game A", "Game B"], {
      force: true,
    });
    for (const key of ["game a", "game b"]) {
      const q = cache.quotes[key];
      assert.equal(q.itadCheckedAt, null);
      assert.equal(q.updatedAt, old);
      assert.equal(q.source, "steam");
      assert.equal(isQuoteLatestStoreLow(q), false);
    }
    assert.equal(cache.updatedAt, old);
  });

  it("applies Steam-shop rows only, and clears the price of a delisted title", async () => {
    await seed();
    const calls = stubFetch({
      "/games/prices/v3": (url) => {
        assert.equal(url.searchParams.get("country"), "IN");
        assert.equal(url.searchParams.get("shops"), "61");
        return [
          {
            id: ITAD_A,
            // all-shops low: must not be used as the Steam store low
            historyLow: { all: { amount: 1, currency: "INR" } },
            deals: [
              {
                shop: { id: 61, name: "Steam" },
                price: { amount: 300, currency: "INR" },
                regular: { amount: 500, currency: "INR" },
                storeLow: { amount: 125, currency: "INR" },
                cut: 40,
              },
            ],
          },
          // answered, but no longer sold on Steam
          { id: ITAD_B, historyLow: { all: { amount: 2, currency: "INR" } }, deals: [] },
        ];
      },
      "/games/storelow/v2": () => [
        {
          id: ITAD_B,
          lows: [{ shop: { id: 61 }, price: { amount: 200, currency: "INR" } }],
        },
      ],
      "/api/storesearch": noSearchResults,
    });
    const cache = await refreshPricesForTitles(["Game A", "Game B"], {
      force: true,
    });
    assert.deepEqual(
      calls.filter((c) => c.startsWith("/games/")),
      ["/games/prices/v3", "/games/storelow/v2"],
    );

    const a = cache.quotes["game a"];
    assert.equal(a.currentInr, 300);
    assert.equal(a.retailInr, 500);
    assert.equal(a.lowestInr, 125);
    assert.equal(a.onSale, true);
    assert.equal(a.currency, "INR");
    assert.equal(a.source, "steam+itad");
    assert.equal(isQuoteLatestStoreLow(a), true);

    const b = cache.quotes["game b"];
    assert.equal(b.currentInr, null);
    assert.equal(b.lowestInr, 200);
    assert.equal(isQuoteLatestStoreLow(b), true);
    assert.notEqual(cache.updatedAt, old);
  });

  it("never lets the API key reach a log line or an error", async () => {
    await seed();
    const KEY = process.env.ITAD_API_KEY!;
    const logged: string[] = [];
    const real = { log: console.log, warn: console.warn, error: console.error };
    console.log = console.warn = console.error = (...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    };
    const urls: string[] = [];
    try {
      // a transport error that quotes the request URL, key included
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = String(input);
        urls.push(url);
        if (url.includes("isthereanydeal")) throw new TypeError(`fetch failed: ${url}`);
        return new Response(JSON.stringify({ total: 0, items: [] }), {
          headers: { "content-type": "application/json" },
        });
      }) as typeof fetch;
      await refreshPricesForTitles(["Game A"], { force: true });

      // rate limit: the one ITAD error that is thrown to the caller
      globalThis.fetch = (async () => new Response("", { status: 429 })) as typeof fetch;
      const err = await refreshPricesForTitles(["Game A"], { force: true }).catch(
        (e: Error) => e,
      );
      assert.ok(err instanceof ItadRateLimitError);
      assert.equal(`${err.message} ${String(err.stack)}`.includes(KEY), false);
    } finally {
      Object.assign(console, real);
    }
    // the key did go out (query parameter), so the check above is meaningful
    assert.equal(urls.some((u) => u.includes(`key=${KEY}`)), true);
    assert.equal(logged.join("\n").includes(KEY), false);
    const disk = await fs.readFile(cacheFile, "utf8");
    assert.equal(disk.includes(KEY), false);
  });

  it("does not store ITAD amounts quoted in a different currency", async () => {
    await seed();
    stubFetch({
      "/games/prices/v3": () => [
        {
          id: ITAD_A,
          deals: [
            {
              shop: { id: 61 },
              price: { amount: 5.99, currency: "USD" },
              regular: { amount: 9.99, currency: "USD" },
              storeLow: { amount: 2.49, currency: "USD" },
            },
          ],
        },
      ],
      "/games/storelow/v2": () => [],
      "/api/storesearch": noSearchResults,
    });
    const a = (await refreshPricesForTitles(["Game A"], { force: true })).quotes[
      "game a"
    ];
    assert.equal(a.currentInr, null);
    assert.equal(a.lowestInr, null);
    assert.equal(a.currency, "INR");
  });
});

describe("weekly freshness without an ITAD key", () => {
  const now = new Date("2026-11-18T00:00:00.000Z");
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
  const steamOnly = (title: string, updatedAt: string) =>
    v1Quote({ title, steamAppId: 1, currentInr: 500, retailInr: 500, updatedAt });
  const cache = {
    quotes: {
      "fresh game": steamOnly("Fresh Game", daysAgo(2)),
      "stale game": steamOnly("Stale Game", daysAgo(9)),
    },
  };

  it("with a key, a Steam-only quote is never 'latest' (no ITAD check yet)", () => {
    assert.equal(isQuoteLatestStoreLow(cache.quotes["fresh game"], now), false);
    assert.equal(isQuoteLatestStoreLow(cache.quotes["fresh game"], now, true), false);
  });

  it("without a key, the Steam price timestamp decides", () => {
    assert.equal(isQuoteLatestStoreLow(cache.quotes["fresh game"], now, false), true);
    assert.equal(isQuoteLatestStoreLow(cache.quotes["stale game"], now, false), false);
    assert.equal(isQuoteLatestStoreLow(undefined, now, false), false);
  });

  it("counts, week-freshness and the refresh queue follow the same rule", () => {
    const titles = ["Fresh Game", "Stale Game"];
    assert.deepEqual(countLatestQuotes(titles, cache, now, false), { latest: 1, total: 2 });
    assert.deepEqual(countLatestQuotes(titles, cache, now, true), { latest: 0, total: 2 });
    assert.equal(isStoreLowsWeekFresh(["Fresh Game"], cache, now, false), true);
    assert.equal(isStoreLowsWeekFresh(titles, cache, now, false), false);
    // only the stale title is queued: a page load does not re-crawl the library
    assert.deepEqual(
      pickOldestTitles(titles, cache, { skipLatestToday: true, now, hasItadKey: false }),
      ["Stale Game"],
    );
    assert.deepEqual(
      pickOldestTitles(titles, cache, { skipLatestToday: true, now, hasItadKey: true }),
      ["Stale Game", "Fresh Game"],
    );
  });
});

describe("is_free backfill", () => {
  it("covers a normal library in one run, up to the per-run cap", async () => {
    assert.equal(IS_FREE_BACKFILL_PER_RUN, 150);
    process.env.ITAD_API_KEY = "test-key-0123456789abcdef";
    const count = IS_FREE_BACKFILL_PER_RUN + 10;
    const quotes: Record<string, GamePriceQuote> = {};
    const titles: string[] = [];
    for (let i = 1; i <= count; i++) {
      const title = `Backfill Game ${i}`;
      titles.push(title);
      quotes[title.toLowerCase()] = {
        ...v1Quote({
          title,
          steamAppId: 1000 + i,
          itadId: `018d937f-0000-7000-8000-${String(i).padStart(12, "0")}`,
          currentInr: 500,
          retailInr: 500,
        }),
        currency: "INR",
      };
    }
    await writeCache({ version: 2, updatedAt: "", country: "IN", currency: "INR", quotes });
    const calls = stubFetch({
      "/api/appdetails": (url) => ({
        [url.searchParams.get("appids")!]: {
          success: true,
          data: { is_free: false, price_overview: { currency: "INR", initial: 50000, final: 50000 } },
        },
      }),
      "/games/prices/v3": () => [],
      "/games/storelow/v2": () => [],
      "/api/storesearch": noSearchResults,
    });
    const cache = await refreshPricesForTitles(titles, { force: true, limit: count });
    assert.equal(
      calls.filter((c) => c.startsWith("/api/appdetails")).length,
      IS_FREE_BACKFILL_PER_RUN,
    );
    const learned = Object.values(cache.quotes).filter((q) => q.isFree === false).length;
    assert.equal(learned, IS_FREE_BACKFILL_PER_RUN);
  });
});
