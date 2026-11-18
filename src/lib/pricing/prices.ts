import {
  itadRateLimiter,
  mapPool,
  steamRateLimiter,
} from "@/lib/async/pool";
import { dataPath, ensureDataDir } from "@/lib/data/load-local";
import {
  CorruptJsonFileError,
  readJsonFile,
  updateJsonFile,
} from "@/lib/data/json-store";
import { resolveItadApiKey } from "@/lib/pricing/itad-credentials";
import { isOffline, netFetch } from "@/lib/runtime";
import {
  resolveStoreRegionFromAccount,
  type StoreRegion,
} from "@/lib/pricing/store-region";
import {
  stripEditionNoise,
  titlesSoftMatch,
} from "@/lib/analytics/acquisition";
import type {
  LoginHistoryRow,
  PurchaseHistoryRow,
} from "@/lib/account-data/parsers";
import { normTitle } from "@/lib/titles";

export type GamePriceQuote = {
  title: string;
  steamAppId: number | null;
  /** Cached IsThereAnyDeal game UUID (avoids repeated lookup calls) */
  itadId?: string | null;
  /**
   * ISO 4217 currency of `currentInr` / `lowestInr` / `retailInr` — the currency
   * the store actually quoted. A price quoted in any other currency than
   * `PriceCache.currency` is not stored in those fields (the title is unpriced).
   */
  currency?: string | null;
  /**
   * Live Steam store price, in `currency`
   * (field name is historical; it is not necessarily INR).
   */
  currentInr: number | null;
  /**
   * Steam store all-time low via IsThereAnyDeal, in `currency`
   * (field name is historical).
   */
  lowestInr: number | null;
  /**
   * When that low was recorded (ISO 8601), if the source reported a date.
   * Nothing fills this yet: the ITAD store-low responses read here carry no
   * timestamp. The dashboard passes it through when present.
   */
  lowestRecordedAt?: string | null;
  /**
   * Steam store list / MSRP, in `currency` (field name is historical).
   */
  retailInr: number | null;
  /**
   * Genuine US-store amounts (USD), kept for reference only. Never used to
   * derive a price in another currency: the old "USD rate" was a regional
   * price ratio, not an exchange rate.
   */
  usd?: {
    current: number | null;
    retail: number | null;
    /** Old CheapShark low, carried over from v1 caches. */
    lowest?: number | null;
  } | null;
  /** Steam appdetails `is_free`, when the store has told us. */
  isFree?: boolean;
  /**
   * @deprecated Always null since cache v2. These held local-currency amounts
   * under a USD name; real USD values moved to `usd`. Do not read.
   */
  lowestUsd: number | null;
  /** @deprecated Always null since cache v2 — see `lowestUsd`. */
  currentUsd: number | null;
  /** @deprecated Always null since cache v2 — see `lowestUsd`. */
  retailUsd: number | null;
  onSale: boolean;
  source:
    | "steam+itad"
    | "steam+cheapshark"
    | "steam+itad+cheapshark"
    | "steam"
    | "unresolved";
  updatedAt: string;
  /**
   * Last successful ITAD attempt (within weekly TTL), even if no store low exists.
   * Used so DLC / missing-ITAD titles don't block the weekly progress bar.
   */
  itadCheckedAt?: string | null;
};

/** Thrown when IsThereAnyDeal returns HTTP 429 — caller should pause the loop. */
export class ItadRateLimitError extends Error {
  constructor(message = "IsThereAnyDeal rate limit (429)") {
    super(message);
    this.name = "ItadRateLimitError";
  }
}

export type PriceCache = {
  /** On-disk schema version; absent on v1 files (migrated on load). */
  version?: number;
  /** Last time a refresh actually obtained data (not merely ran). */
  updatedAt: string;
  /** ISO country used for Steam cc + ITAD country */
  country?: string;
  /** ISO currency for currentInr / lowestInr / retailInr amounts */
  currency?: string;
  quotes: Record<string, GamePriceQuote>;
};

export const PRICE_CACHE_VERSION = 2;
const CACHE_FILE = "price-cache.json";
const UA = "steam-stats-local/0.1 (personal; localhost)";
/** Serial refreshes — ITAD window limiter paces requests. */
const TITLE_CONCURRENCY = 1;
const CHECKPOINT_EVERY = 5;
/** Store lows stay valid this long before a weekly refresh is needed. */
export const PRICE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** IsThereAnyDeal shop id for Steam */
const ITAD_STEAM_SHOP = 61;

/** Active region for the current refresh / helpers (Steam cc + ITAD country). */
let activeStoreRegion: StoreRegion = {
  country: "US",
  currency: "USD",
  source: "default",
};

function steamCc(): string {
  return activeStoreRegion.country.toLowerCase();
}

function itadCountry(): string {
  return activeStoreRegion.country.toUpperCase();
}

/**
 * When detected region differs from cache, clear local store prices so the
 * next refresh fills the new country’s quotes (keep app / ITAD ids).
 */
export async function applyStoreRegionToCache(
  cache: PriceCache,
  region: StoreRegion,
  opts?: {
    /**
     * false = apply in memory only. The request path passes this so a GET never
     * rewrites price-cache.json; the refresh script persists (default).
     */
    persist?: boolean;
  },
): Promise<PriceCache> {
  // Never write from a read path when offline.
  const persist = opts?.persist !== false && !isOffline();
  const prevCc = cache.country?.toUpperCase() ?? null;
  const nextCc = region.country.toUpperCase();
  const prevCur = cache.currency?.toUpperCase() ?? null;
  const nextCur = region.currency.toUpperCase();
  const changed = prevCc !== nextCc || prevCur !== nextCur;

  cache.country = nextCc;
  cache.currency = nextCur;
  activeStoreRegion = region;

  if (changed && prevCc != null) {
    for (const q of Object.values(cache.quotes)) {
      q.currentInr = null;
      q.lowestInr = null;
      q.retailInr = null;
      q.currency = nextCur;
      q.itadCheckedAt = null;
      if (q.source === "steam+itad" || q.source === "steam+itad+cheapshark") {
        q.source = "steam";
      }
    }
    if (persist) {
      cache.updatedAt = new Date().toISOString();
      await savePriceCache(cache);
    }
  } else if (persist && (prevCc == null || prevCur == null || changed)) {
    // Persist newly detected region (or currency fill-in) without wiping quotes
    await savePriceCache(cache);
  }

  return cache;
}

export async function resolveAndApplyStoreRegion(
  cache?: PriceCache,
  account?: {
    purchases: PurchaseHistoryRow[];
    loginHistory: LoginHistoryRow[];
  },
  opts?: { persist?: boolean },
): Promise<{ region: StoreRegion; cache: PriceCache }> {
  const loaded = cache ?? (await loadPriceCache());
  const region = await resolveStoreRegionFromAccount({
    cachedCountry: loaded.country,
    cachedCurrency: loaded.currency,
    purchases: account?.purchases,
    loginCountries: account?.loginHistory.map((r) => r.country),
  });
  await applyStoreRegionToCache(loaded, region, opts);
  return { region, cache: loaded };
}

/** CheapShark is no longer a source (its USD low moved to `usd.lowest`). */
function normalizeSource(
  source: string | undefined,
): GamePriceQuote["source"] {
  if (source === "unresolved") return "unresolved";
  if (source?.includes("itad")) return "steam+itad";
  if (source?.includes("steam")) return "steam";
  return "unresolved";
}

export async function hasItadApiKey(): Promise<boolean> {
  return Boolean(await resolveItadApiKey());
}

/** True when an ISO timestamp is within `ttlMs` of now. */
export function isWithinTtl(
  iso: string | null | undefined,
  ttlMs = PRICE_CACHE_TTL_MS,
  now = Date.now(),
): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  return now - t < ttlMs;
}

/** Has a real Steam store hist low (ITAD) for the active country. */
export function quoteHasStoreLow(
  quote: Pick<GamePriceQuote, "lowestInr"> | null | undefined,
): boolean {
  return quote != null && quote.lowestInr != null && quote.lowestInr > 0;
}

/**
 * Quote is “fresh” for the weekly bar: ITAD was checked within 7 days
 * (with or without a store low — DLC/missing rows still settle).
 *
 * `hasItadKey: false` — there is no ITAD check to wait for, so the Steam price
 * timestamp (`updatedAt`) decides. Otherwise nothing would ever count as
 * fresh without a key and every page load would re-crawl the whole library.
 */
export function isQuoteLatestStoreLow(
  quote:
    | Pick<GamePriceQuote, "updatedAt" | "lowestInr" | "itadCheckedAt">
    | null
    | undefined,
  now = new Date(),
  hasItadKey = true,
): boolean {
  if (!quote) return false;
  if (!hasItadKey) {
    return isWithinTtl(quote.updatedAt, PRICE_CACHE_TTL_MS, now.getTime());
  }
  const stamp =
    quote.itadCheckedAt || (quoteHasStoreLow(quote) ? quote.updatedAt : null);
  return isWithinTtl(stamp, PRICE_CACHE_TTL_MS, now.getTime());
}

/** How many library titles have a fresh (≤7 day) ITAD check stored. */
export function countLatestQuotes(
  titles: string[],
  cache: Pick<PriceCache, "quotes">,
  now = new Date(),
  hasItadKey = true,
): { latest: number; total: number } {
  const total = titles.length;
  let latest = 0;
  for (const title of titles) {
    const q = cache.quotes[normTitle(title)];
    if (isQuoteLatestStoreLow(q, now, hasItadKey)) latest += 1;
  }
  return { latest, total };
}

/**
 * Oldest / unchecked titles first. Optionally skip titles still fresh this week.
 */
export function pickOldestTitles(
  titles: string[],
  cache: Pick<PriceCache, "quotes">,
  opts?: {
    limit?: number;
    skipLatestToday?: boolean;
    now?: Date;
    /** See `isQuoteLatestStoreLow`. Default true. */
    hasItadKey?: boolean;
  },
): string[] {
  const now = opts?.now ?? new Date();
  const limit = opts?.limit ?? titles.length;
  const ranked = titles
    .map((title) => {
      const q = cache.quotes[normTitle(title)];
      const stamp = q?.itadCheckedAt || q?.updatedAt;
      const ts = stamp ? Date.parse(stamp) : 0;
      const hasLow = quoteHasStoreLow(q);
      const rankTs = Number.isFinite(ts) ? ts : 0;
      return {
        title,
        ts: rankTs,
        latest: isQuoteLatestStoreLow(q, now, opts?.hasItadKey ?? true),
        hasLow,
      };
    })
    .filter((r) => !(opts?.skipLatestToday && r.latest))
    .sort((a, b) => {
      if (a.hasLow !== b.hasLow) return a.hasLow ? 1 : -1;
      return a.ts - b.ts || a.title.localeCompare(b.title);
    });

  return ranked.slice(0, limit).map((r) => r.title);
}

/** Library store lows are fresh for this week (all titles checked ≤7 days). */
export function isStoreLowsWeekFresh(
  titles: string[],
  cache: Pick<PriceCache, "quotes">,
  now = new Date(),
  hasItadKey = true,
): boolean {
  if (!titles.length) return true;
  const { latest, total } = countLatestQuotes(titles, cache, now, hasItadKey);
  return total > 0 && latest >= total;
}

function sameAmount(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(0.01, Math.abs(b) * 0.005);
}

/**
 * Bring a cache of any older shape to the current one, in memory.
 * Never drops a quote, an app id, an ITAD id or a local price.
 *
 * v1 → v2: the `*Usd` fields were filled from a store search made with the
 * local country code, so they often held local-currency amounts. Each quote
 * now carries its `currency`; a `*Usd` value that merely repeats the local
 * amount is discarded (nothing is lost), a real USD value moves to `usd`, and
 * the legacy fields are nulled so nothing can multiply them by a "rate" again.
 */
export function migratePriceCache(cache: PriceCache): PriceCache {
  cache.quotes ??= {};
  if (typeof cache.updatedAt !== "string") cache.updatedAt = "";
  const storeCur = cache.currency?.trim().toUpperCase() || null;

  for (const q of Object.values(cache.quotes)) {
    q.source = normalizeSource(q.source);
    if (q.currentInr === undefined) q.currentInr = null;
    if (q.lowestInr === undefined) q.lowestInr = null;
    if (q.retailInr === undefined) q.retailInr = null;
    if (q.currency === undefined) q.currency = storeCur;

    const current = q.currentUsd ?? null;
    const retail = q.retailUsd ?? null;
    const lowest = q.lowestUsd ?? null;
    if (current != null || retail != null || lowest != null) {
      if (storeCur === "USD") {
        // Same currency as the local fields: only fill gaps.
        q.currentInr ??= current;
        q.retailInr ??= retail;
      } else {
        const repeatsLocal =
          (current != null &&
            q.currentInr != null &&
            sameAmount(current, q.currentInr)) ||
          (retail != null &&
            q.retailInr != null &&
            sameAmount(retail, q.retailInr));
        const usd = {
          current: repeatsLocal ? null : current,
          retail: repeatsLocal ? null : retail,
          lowest,
        };
        if (usd.current != null || usd.retail != null || usd.lowest != null) {
          q.usd = usd;
        }
      }
    }
    q.currentUsd = null;
    q.retailUsd = null;
    q.lowestUsd = null;
  }

  cache.version = PRICE_CACHE_VERSION;
  return cache;
}

function quoteStamp(q: GamePriceQuote | undefined): number {
  const t = q?.updatedAt ? Date.parse(q.updatedAt) : NaN;
  return Number.isFinite(t) ? t : 0;
}

/**
 * Fold what is on disk into the in-memory cache about to be saved, so a writer
 * holding a minutes-old copy cannot erase another process's quotes.
 * Per quote the newer `updatedAt` wins; quotes only on disk are kept.
 * If the disk copy is in another store currency, its local amounts are not
 * carried over (ids are).
 */
export function mergePriceCaches(mine: PriceCache, disk: PriceCache): PriceCache {
  const mineCur = mine.currency?.toUpperCase() ?? null;
  const diskCur = disk.currency?.toUpperCase() ?? null;
  const sameCurrency = !mineCur || !diskCur || mineCur === diskCur;

  for (const [key, theirs] of Object.entries(disk.quotes ?? {})) {
    const ours = mine.quotes[key];
    if (!ours) {
      mine.quotes[key] = sameCurrency
        ? theirs
        : {
            ...theirs,
            currency: mineCur,
            currentInr: null,
            lowestInr: null,
            retailInr: null,
            itadCheckedAt: null,
          };
    } else if (sameCurrency && quoteStamp(theirs) > quoteStamp(ours)) {
      mine.quotes[key] = theirs;
    }
  }
  if ((Date.parse(disk.updatedAt) || 0) > (Date.parse(mine.updatedAt) || 0)) {
    mine.updatedAt = disk.updatedAt;
  }
  mine.country ??= disk.country;
  mine.currency ??= disk.currency;
  return mine;
}

/** A cache with no quotes — what a missing file loads as. */
export function emptyPriceCache(): PriceCache {
  return { version: PRICE_CACHE_VERSION, updatedAt: "", quotes: {} };
}

/**
 * Missing file → empty cache. A file that exists but cannot be read or parsed
 * → throws `CorruptJsonFileError` (it is left untouched; `<file>.bak` holds
 * the last good copy). Read-only: migration happens in memory.
 */
export async function loadPriceCache(): Promise<PriceCache> {
  const file = dataPath(CACHE_FILE);
  const parsed = await readJsonFile<PriceCache>(file);
  if (parsed === undefined) return emptyPriceCache();
  assertPriceCacheShape(parsed, file);
  return migratePriceCache(parsed);
}

function assertPriceCacheShape(parsed: unknown, file: string) {
  const quotes = (parsed as PriceCache | null)?.quotes;
  if (
    parsed == null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    (quotes !== undefined &&
      (quotes == null || typeof quotes !== "object" || Array.isArray(quotes)))
  ) {
    throw new CorruptJsonFileError(file, "not a price cache object");
  }
}

/**
 * Atomic, locked save: re-reads the file, merges it into `cache` (see
 * `mergePriceCaches`), keeps the previous file as `.bak`, then renames a temp
 * file into place. Throws instead of writing if the file on disk is corrupt.
 */
export async function savePriceCache(cache: PriceCache) {
  await ensureDataDir();
  const file = dataPath(CACHE_FILE);
  cache.version = PRICE_CACHE_VERSION;
  await updateJsonFile<PriceCache>(
    file,
    (disk) => {
      if (disk === undefined) return cache;
      assertPriceCacheShape(disk, file);
      return mergePriceCaches(cache, migratePriceCache(disk));
    },
    { backup: true },
  );
}

async function fetchJson<T>(
  url: string,
  init?: RequestInit & { itad?: boolean },
): Promise<T | null> {
  try {
    const { itad, ...rest } = init ?? {};
    const res = await netFetch(url, {
      ...rest,
      signal: rest.signal ?? AbortSignal.timeout(15_000),
      headers: {
        "User-Agent": UA,
        Accept: "application/json",
        ...(rest.headers ?? {}),
      },
      cache: "no-store",
    });
    if (res.status === 429) {
      if (itad) throw new ItadRateLimitError();
      await new Promise((r) => setTimeout(r, 3_000));
      return null;
    }
    if (!res.ok) return null;
    const text = await res.text();
    if (!text) return null;
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("json")) return null;
    return JSON.parse(text) as T;
  } catch (err) {
    if (err instanceof ItadRateLimitError) throw err;
    return null;
  }
}

type StoreSearchItem = {
  type: string;
  name: string;
  id: number;
  price?: { currency: string; initial: number; final: number };
};

/** `null` = the request failed (retry later); `[]` = the store has no match. */
async function steamStoreSearchItems(
  term: string,
  cc: string,
): Promise<StoreSearchItem[] | null> {
  const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&l=english&cc=${cc}`;
  const data = await steamRateLimiter.schedule(() =>
    fetchJson<{ total: number; items: StoreSearchItem[] }>(url),
  );
  if (!data) return null;
  return Array.isArray(data.items) ? data.items : [];
}

/**
 * `answered` is false when no search request succeeded, so the caller can tell
 * "not on the store" from "could not ask".
 */
async function steamStoreSearch(
  title: string,
): Promise<{ answered: boolean; hit: StoreSearchItem | null }> {
  let answered = false;
  const queries = [
    title,
    title.replace(/\s*[-–—]\s*/g, " "),
    title.replace(/\s*[-–—]\s*/g, ": "),
  ];
  const seen = new Set<string>();

  for (const q of queries) {
    const term = q.trim();
    if (!term || seen.has(term.toLowerCase())) continue;
    seen.add(term.toLowerCase());

    const items = await steamStoreSearchItems(term, steamCc());
    if (items == null) continue;
    answered = true;
    if (!items.length) continue;

    const apps = items.filter((i) => i.type === "app");
    const pool = apps.length ? apps : items;
    const norm = normTitle(title);
    const loose = (t: string) =>
      normTitle(t)
        .replace(/[-–—:]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    const looseNorm = loose(title);

    const hit =
      pool.find((g) => normTitle(g.name) === norm) ??
      pool.find((g) => loose(g.name) === looseNorm) ??
      pool.find((g) => normTitle(g.name).startsWith(norm)) ??
      pool.find((g) => normTitle(g.name).includes(norm)) ??
      pool.find((g) => norm.includes(normTitle(g.name))) ??
      // No "first result" fallback: an unrelated app's id and price is worse
      // than an unresolved title.
      null;
    if (hit) return { answered, hit };
  }

  return { answered, hit: null };
}

/** Prefer remasters / currently listed editions when the owned SKU is unlisted. */
function editionProxyRank(name: string): number {
  const n = normTitle(name);
  if (/\bremastered\b|\bhd remaster\b/.test(n)) return 50;
  if (/\benhanced\b/.test(n)) return 40;
  if (/\bdefinitive\b/.test(n)) return 35;
  if (/\bcomplete edition\b/.test(n)) return 5;
  return 20;
}

/**
 * Find a soft-matched Steam store listing that still has a price
 * (e.g. Horizon Complete Edition → Horizon Remastered).
 */
async function findPricedEditionProxy(
  title: string,
  excludeAppId: number | null,
): Promise<{
  appId: number;
  name: string;
  currentInr: number;
  retailInr: number | null;
} | null> {
  const base = stripEditionNoise(title);
  const queries = [
    title,
    base,
    base ? `${base} Remastered` : "",
    base ? `${base} Enhanced` : "",
  ].filter((q) => q.trim().length >= 4);

  const seenApps = new Set<number>();
  const candidates: StoreSearchItem[] = [];
  const cc = steamCc();

  for (const q of queries) {
    const items = (await steamStoreSearchItems(q, cc)) ?? [];
    for (const item of items) {
      if (item.type !== "app") continue;
      if (excludeAppId != null && item.id === excludeAppId) continue;
      if (seenApps.has(item.id)) continue;
      if (
        !titlesSoftMatch(title, item.name) &&
        !(base.length >= 4 && titlesSoftMatch(base, item.name))
      ) {
        continue;
      }
      seenApps.add(item.id);
      candidates.push(item);
    }
  }

  candidates.sort(
    (a, b) => editionProxyRank(b.name) - editionProxyRank(a.name),
  );

  const localCur = activeStoreRegion.currency.toUpperCase();
  const isLocal = (cur: string | null | undefined) =>
    !cur || cur.toUpperCase() === localCur;

  for (const c of candidates) {
    const overview = await steamAppPrice(c.id, cc);
    if (
      overview?.final != null &&
      overview.final > 0 &&
      isLocal(overview.currency)
    ) {
      return {
        appId: c.id,
        name: c.name,
        currentInr: overview.final,
        retailInr: overview.initial ?? null,
      };
    }
    if (
      c.price?.final != null &&
      c.price.final > 0 &&
      isLocal(c.price.currency)
    ) {
      return {
        appId: c.id,
        name: c.name,
        currentInr: c.price.final / 100,
        retailInr:
          c.price.initial != null && c.price.initial > 0
            ? c.price.initial / 100
            : null,
      };
    }
  }
  return null;
}

type SteamAppPrice = {
  /** null when the store lists no price (free, unreleased, delisted, region-locked) */
  final: number | null;
  initial: number | null;
  /** Currency Steam actually quoted (can differ from the requested country's). */
  currency: string | null;
  isFree: boolean | null;
};

/**
 * Store price for one app. `null` = the request failed or Steam refused the
 * app id (nothing learned, retry later) — distinct from "answered, no price".
 */
async function steamAppPrice(
  appId: number,
  cc: string,
): Promise<SteamAppPrice | null> {
  const url = `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=${cc}&filters=basic,price_overview`;
  const data = await steamRateLimiter.schedule(() =>
    fetchJson<
      Record<
        string,
        {
          success?: boolean;
          data?: {
            is_free?: boolean;
            price_overview?: {
              currency?: string;
              final?: number;
              initial?: number;
            };
          };
        }
      >
    >(url),
  );
  const entry = data?.[String(appId)];
  if (!entry?.success) return null;
  const isFree =
    typeof entry.data?.is_free === "boolean" ? entry.data.is_free : null;
  const overview = entry.data?.price_overview;
  if (!overview || overview.final == null) {
    return { final: null, initial: null, currency: null, isFree };
  }
  const final = overview.final / 100;
  return {
    final,
    initial: overview.initial != null ? overview.initial / 100 : final,
    currency: overview.currency?.trim().toUpperCase() || null,
    isFree,
  };
}

/**
 * One ITAD POST, rate-limited. Returns null on any failure.
 *
 * ITAD authenticates an API key through the `key` query parameter; that is the
 * only scheme its API defines for keys (the Authorization header is for OAuth
 * access tokens, which this app does not have). The key therefore has to be in
 * the URL, which makes the URL itself a secret: it is built here, handed
 * straight to `fetchJson`, and never logged, returned or put in an error.
 */
async function itadPost<T>(
  path: string,
  query: Record<string, string>,
  body: unknown,
): Promise<T | null> {
  const key = await resolveItadApiKey();
  if (!key) return null;
  const url = new URL(`https://api.isthereanydeal.com${path}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  url.searchParams.set("key", key);
  return itadRateLimiter.schedule(() =>
    fetchJson<T>(url.toString(), {
      itad: true,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

/**
 * Bulk Steam appid → ITAD id via POST /lookup/id/shop/61/v1
 * Body: ["app/123", ...] — one request for many games (not /games/lookup/v1).
 * An app id missing from the returned map means the request failed.
 */
async function itadBulkLookupSteamAppIds(
  appIds: number[],
): Promise<Map<number, string | null>> {
  const out = new Map<number, string | null>();
  if (!appIds.length) return out;
  if (!(await hasItadApiKey())) return out;

  const unique = [...new Set(appIds.filter((id) => id > 0))];
  const CHUNK = 100;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    const body = chunk.map((id) => `app/${id}`);
    const map = await itadPost<Record<string, string | null>>(
      `/lookup/id/shop/${ITAD_STEAM_SHOP}/v1`,
      {},
      body,
    );
    // Failed request: leave these ids out, so the caller does not record
    // "ITAD does not know this game".
    if (map == null || typeof map !== "object") continue;
    for (const id of chunk) {
      const raw = map[`app/${id}`];
      out.set(id, typeof raw === "string" && raw.length > 0 ? raw : null);
    }
  }
  return out;
}

type ItadMoney = { amount?: number; currency?: string };

type ItadSteamPrices = {
  currentInr: number | null;
  retailInr: number | null;
  lowestInr: number | null;
  /** Currency ITAD quoted; null when the game has no Steam price row. */
  currency: string | null;
};

const positive = (n: number | undefined): number | null =>
  n != null && n > 0 ? n : null;

/**
 * Bulk Steam current + store-low via POST /games/prices/v3
 * (active country, shops=61). One request covers up to 200 games.
 *
 * An id missing from the returned map means its request failed. An id that is
 * present with all-null amounts means ITAD answered and has no Steam price.
 * Only the shop-61 deal is read: `historyLow.all` is the low across every
 * shop ITAD tracks, and "the first deal" may be another shop's.
 */
async function itadBulkSteamStorePrices(
  itadIds: string[],
): Promise<Map<string, ItadSteamPrices>> {
  const out = new Map<string, ItadSteamPrices>();
  if (!itadIds.length) return out;
  if (!(await hasItadApiKey())) return out;

  const country = itadCountry();
  const unique = [...new Set(itadIds.filter(Boolean))];
  const CHUNK = 200;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    const rows = await itadPost<
      Array<{
        id?: string;
        deals?: Array<{
          shop?: { id?: number };
          price?: ItadMoney;
          regular?: ItadMoney;
          storeLow?: ItadMoney;
          cut?: number;
        }>;
      }>
    >("/games/prices/v3", { country, shops: String(ITAD_STEAM_SHOP) }, chunk);
    if (!Array.isArray(rows)) continue;
    const byId = new Map(rows.map((r) => [r.id, r] as const));
    for (const id of chunk) {
      const steam = byId
        .get(id)
        ?.deals?.find((d) => d.shop?.id === ITAD_STEAM_SHOP);
      out.set(id, {
        currentInr: positive(steam?.price?.amount),
        retailInr: positive(steam?.regular?.amount),
        lowestInr: positive(steam?.storeLow?.amount),
        currency:
          (
            steam?.price?.currency ??
            steam?.regular?.currency ??
            steam?.storeLow?.currency
          )
            ?.trim()
            .toUpperCase() || null,
      });
    }
  }
  return out;
}

function softRelatedQuote(
  key: string,
  q: GamePriceQuote,
  otherKey: string,
  other: GamePriceQuote,
): boolean {
  if (otherKey === key) return false;
  if (
    q.steamAppId != null &&
    other.steamAppId != null &&
    q.steamAppId === other.steamAppId
  ) {
    return false;
  }
  return (
    titlesSoftMatch(q.title, other.title) ||
    titlesSoftMatch(q.title, otherKey) ||
    titlesSoftMatch(key, other.title)
  );
}

/**
 * Remaster / edition SKUs often lack Steam store-low or are unlisted;
 * copy lows (and missing current) from soft-matched quotes already in cache.
 */
function backfillEditionLowsFromRelated(cache: PriceCache): void {
  for (const [key, q] of Object.entries(cache.quotes)) {
    // A free app has no price to borrow; another product's would be invented.
    if (q.isFree) continue;
    const needLow = q.lowestInr == null || q.lowestInr <= 0;
    const needCurrent = q.currentInr == null || q.currentInr <= 0;
    if (!needLow && !needCurrent) continue;

    let bestLow: number | null = null;
    let bestCurrent: {
      current: number;
      retail: number | null;
      rank: number;
    } | null = null;

    for (const [otherKey, other] of Object.entries(cache.quotes)) {
      if (!softRelatedQuote(key, q, otherKey, other)) continue;

      if (needLow && other.lowestInr != null && other.lowestInr > 0) {
        bestLow =
          bestLow == null
            ? other.lowestInr
            : Math.min(bestLow, other.lowestInr);
      }
      if (needCurrent && other.currentInr != null && other.currentInr > 0) {
        const rank = editionProxyRank(other.title);
        if (!bestCurrent || rank > bestCurrent.rank) {
          bestCurrent = {
            current: other.currentInr,
            retail: other.retailInr,
            rank,
          };
        }
      }
    }

    if (bestLow != null) {
      q.lowestInr = bestLow;
      if (!q.source.includes("itad")) {
        q.source =
          q.source === "steam" || q.source === "unresolved"
            ? "steam+itad"
            : q.source;
      }
    }
    if (bestCurrent != null) {
      q.currentInr = bestCurrent.current;
      if (q.retailInr == null && bestCurrent.retail != null) {
        q.retailInr = bestCurrent.retail;
      }
      if (q.currentInr != null && q.retailInr != null) {
        q.onSale = q.currentInr < q.retailInr;
      }
      if (q.source === "unresolved") q.source = "steam";
    }
  }
}

/**
 * Owned edition unlisted in the store (no current / no ITAD low) → price from a
 * still-listed soft-matched edition (Complete Edition → Remastered).
 */
async function backfillUnlistedFromAvailableEditions(
  cache: PriceCache,
  titles: string[],
): Promise<void> {
  const keys = [...new Set(titles.map(normTitle))];
  const proxyAppsNeeded: { key: string; appId: number }[] = [];

  for (const key of keys) {
    const q = cache.quotes[key];
    if (!q || q.isFree) continue;
    const needCurrent = q.currentInr == null || q.currentInr <= 0;
    const needLow = q.lowestInr == null || q.lowestInr <= 0;
    if (!needCurrent && !needLow) continue;

    const proxy = await findPricedEditionProxy(q.title, q.steamAppId);
    if (!proxy) continue;

    if (needCurrent) {
      q.currentInr = proxy.currentInr;
      if (q.retailInr == null) q.retailInr = proxy.retailInr;
      if (q.currentInr != null && q.retailInr != null) {
        q.onSale = q.currentInr < q.retailInr;
      }
      if (q.source === "unresolved") q.source = "steam";
      else if (q.source === "steam" || q.source.startsWith("steam")) {
        /* keep */
      }
    }

    if (needLow) {
      proxyAppsNeeded.push({ key, appId: proxy.appId });
    }
    q.updatedAt = new Date().toISOString();
  }

  if (!proxyAppsNeeded.length || !(await hasItadApiKey())) return;

  const looked = await itadBulkLookupSteamAppIds(
    proxyAppsNeeded.map((p) => p.appId),
  );
  const withItad = proxyAppsNeeded
    .map((p) => ({ ...p, itadId: looked.get(p.appId) ?? null }))
    .filter((p): p is { key: string; appId: number; itadId: string } =>
      Boolean(p.itadId),
    );
  if (!withItad.length) return;

  const prices = await itadBulkSteamStorePrices(withItad.map((p) => p.itadId));
  const stillNeed = withItad.filter((p) => prices.get(p.itadId)?.lowestInr == null);
  const storeLows = stillNeed.length
    ? await itadBulkSteamStoreLows(stillNeed.map((p) => p.itadId))
    : new Map<string, ItadStoreLow>();

  for (const p of withItad) {
    const q = cache.quotes[p.key];
    if (!q || (q.lowestInr != null && q.lowestInr > 0)) continue;
    const row = prices.get(p.itadId);
    const fallback = storeLows.get(p.itadId);
    const low =
      (isCacheCurrency(cache, row?.currency) ? row?.lowestInr : null) ??
      (isCacheCurrency(cache, fallback?.currency) ? fallback?.amount : null) ??
      null;
    if (low == null || low <= 0) continue;
    q.lowestInr = low;
    q.source = "steam+itad";
    q.itadCheckedAt = new Date().toISOString();
    q.updatedAt = q.itadCheckedAt;
  }
}

type ItadStoreLow = { amount: number | null; currency: string | null };

/** A quoted currency we may store in the local fields (unknown = trust the request). */
function isCacheCurrency(
  cache: Pick<PriceCache, "currency">,
  currency: string | null | undefined,
): boolean {
  const local = (cache.currency ?? activeStoreRegion.currency).toUpperCase();
  return !currency || currency.toUpperCase() === local;
}

/**
 * Bulk Steam store-lows via POST /games/storelow/v2.
 * Used when prices/v3 returns no Steam storeLow. As with prices/v3, an id
 * missing from the returned map means the request failed.
 */
async function itadBulkSteamStoreLows(
  itadIds: string[],
): Promise<Map<string, ItadStoreLow>> {
  const out = new Map<string, ItadStoreLow>();
  if (!itadIds.length) return out;
  if (!(await hasItadApiKey())) return out;

  const country = itadCountry();
  const unique = [...new Set(itadIds.filter(Boolean))];
  const CHUNK = 200;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    const lows = await itadPost<
      Array<{
        id?: string;
        lows?: Array<{ shop?: { id?: number }; price?: ItadMoney }>;
      }>
    >("/games/storelow/v2", { country, shops: String(ITAD_STEAM_SHOP) }, chunk);
    if (!Array.isArray(lows)) continue;
    const byId = new Map(lows.map((r) => [r.id, r] as const));
    for (const id of chunk) {
      const steamLow = byId
        .get(id)
        ?.lows?.find((l) => l.shop?.id === ITAD_STEAM_SHOP);
      out.set(id, {
        amount: positive(steamLow?.price?.amount),
        currency: steamLow?.price?.currency?.trim().toUpperCase() || null,
      });
    }
  }
  return out;
}

/**
 * Apply store current + hist lows using minimal ITAD traffic:
 * - 0–1 bulk shop lookups (only for titles missing cached itadId)
 * - 1 bulk prices/v3 call per ≤200 games (current + Steam store low)
 * - 1 bulk storelow/v2 for any still missing a low
 * Reuses cached itadId. Re-fetches when a title has no store low yet
 * (even if it was “checked” this week).
 *
 * A quote is stamped `itadCheckedAt` only when ITAD actually answered for it;
 * a failed request leaves the quote exactly as it was, to be retried.
 * Returns how many quotes got an answer.
 */
async function enrichWithItadStoreLows(
  cache: PriceCache,
  titles: string[],
): Promise<number> {
  if (!(await hasItadApiKey())) return 0;

  const nowIso = new Date().toISOString();
  const keys = [...new Set(titles.map(normTitle))];
  const need: { key: string; appId: number; itadId: string | null }[] = [];
  let answered = 0;

  for (const key of keys) {
    const q = cache.quotes[key];
    if (!q) continue;
    // Keep existing lows that are still within the weekly TTL.
    // Titles checked but still missing a low are retried.
    if (quoteHasStoreLow(q) && isQuoteLatestStoreLow(q)) continue;
    if (q.steamAppId == null || q.isFree) {
      // Not on Steam, or free to play: there is no price for ITAD to supply.
      q.itadCheckedAt = nowIso;
      q.updatedAt = nowIso;
      continue;
    }
    need.push({
      key,
      appId: q.steamAppId,
      itadId: q.itadId ?? null,
    });
  }
  if (!need.length) return answered;

  const missingLookup = [
    ...new Set(need.filter((n) => !n.itadId).map((n) => n.appId)),
  ];
  const looked = missingLookup.length
    ? await itadBulkLookupSteamAppIds(missingLookup)
    : new Map<number, string | null>();

  const withItad: { key: string; appId: number; itadId: string }[] = [];
  for (const n of need) {
    const q = cache.quotes[n.key];
    if (!q) continue;
    if (n.itadId) {
      withItad.push({ ...n, itadId: n.itadId });
      continue;
    }
    // Lookup failed for this app: unknown, not "ITAD has no such game".
    if (!looked.has(n.appId)) continue;
    const id = looked.get(n.appId) ?? null;
    q.itadId = id;
    if (id) {
      withItad.push({ ...n, itadId: id });
    } else {
      q.itadCheckedAt = nowIso;
      q.updatedAt = nowIso;
      answered += 1;
    }
  }

  if (withItad.length) {
    const prices = await itadBulkSteamStorePrices(
      withItad.map((n) => n.itadId),
    );
    const stillNeedLow = withItad.filter((n) => {
      const row = prices.get(n.itadId);
      return row != null && row.lowestInr == null;
    });
    const storeLows = stillNeedLow.length
      ? await itadBulkSteamStoreLows(stillNeedLow.map((n) => n.itadId))
      : new Map<string, ItadStoreLow>();

    for (const n of withItad) {
      const q = cache.quotes[n.key];
      if (!q) continue;
      const row = prices.get(n.itadId);
      // prices/v3 failed for this id: leave the quote untouched.
      if (!row) continue;
      q.itadId = n.itadId;

      const fallback = row.lowestInr == null ? storeLows.get(n.itadId) : null;
      // row has no low and the storelow request failed → low still unknown
      const lowKnown = row.lowestInr != null || fallback != null;

      if (isCacheCurrency(cache, row.currency)) {
        q.currency = (cache.currency ?? activeStoreRegion.currency).toUpperCase();
        // ITAD answered: no Steam price means the title is not sold in this
        // region any more, so a stale price must not linger.
        q.currentInr = row.currentInr;
        if (row.retailInr != null) q.retailInr = row.retailInr;
        if (row.lowestInr != null) q.lowestInr = row.lowestInr;
      } else {
        // Quoted in another currency: unpriced here rather than mislabelled.
        q.currentInr = null;
      }
      if (
        fallback?.amount != null &&
        isCacheCurrency(cache, fallback.currency)
      ) {
        q.lowestInr = fallback.amount;
      }
      q.onSale =
        q.currentInr != null && q.retailInr != null
          ? q.currentInr < q.retailInr
          : false;
      q.source = "steam+itad";
      q.updatedAt = nowIso;
      if (lowKnown) q.itadCheckedAt = nowIso;
      answered += 1;
    }
  }

  backfillEditionLowsFromRelated(cache);
  await backfillUnlistedFromAvailableEditions(cache, titles);
  return answered;
}

function unresolvedQuote(
  title: string,
  opts?: { itadCheckedAt?: string | null },
): GamePriceQuote {
  return {
    title,
    steamAppId: null,
    itadId: null,
    currency: null,
    currentUsd: null,
    lowestUsd: null,
    currentInr: null,
    lowestInr: null,
    retailInr: null,
    retailUsd: null,
    onSale: false,
    source: "unresolved",
    updatedAt: new Date().toISOString(),
    itadCheckedAt: opts?.itadCheckedAt ?? null,
  };
}

/**
 * Local-currency amounts from a Steam answer. A price quoted in another
 * currency (Steam falls back to USD for some countries) is not stored as
 * local; a USD one is kept as the labelled `usd` reference.
 */
function localAmounts(
  price: { final: number | null; initial: number | null; currency: string | null },
  localCurrency: string,
): Pick<GamePriceQuote, "currentInr" | "retailInr"> & {
  usd?: GamePriceQuote["usd"];
} {
  if (!price.currency || price.currency === localCurrency) {
    return { currentInr: price.final, retailInr: price.initial };
  }
  return {
    currentInr: null,
    retailInr: null,
    ...(price.currency === "USD"
      ? { usd: { current: price.final, retail: price.initial } }
      : {}),
  };
}

/**
 * Steam live quote only — no ITAD calls (ITAD is applied in bulk after).
 * Returns `null` when Steam could not be asked (network / HTTP failure):
 * the caller keeps whatever it had and nothing is stamped as refreshed.
 */
async function refreshOneTitle(
  title: string,
  previous?: GamePriceQuote,
): Promise<GamePriceQuote | null> {
  const itadOn = await hasItadApiKey();
  const localCurrency = activeStoreRegion.currency.toUpperCase();
  const nowIso = new Date().toISOString();
  const knownApp =
    previous?.steamAppId != null && previous.source !== "unresolved";

  let appId: number;
  let name: string;
  let searchPrice: StoreSearchItem["price"] | undefined;

  if (knownApp) {
    // Already resolved: re-read the price, never re-guess the app.
    appId = previous!.steamAppId!;
    name = previous!.title;
  } else {
    const { answered, hit } = await steamStoreSearch(title);
    if (!answered) return null;
    if (!hit) {
      return unresolvedQuote(title, {
        itadCheckedAt: itadOn ? nowIso : previous?.itadCheckedAt,
      });
    }
    appId = hit.id;
    name = hit.name;
    searchPrice = hit.price;
  }

  const store = await steamAppPrice(appId, steamCc());
  if (!store && knownApp) return null;

  // appdetails did not answer for a freshly resolved app: fall back to the
  // search hit's own price, which carries its currency.
  const amounts = store
    ? localAmounts(store, localCurrency)
    : searchPrice
      ? localAmounts(
          {
            final: searchPrice.final / 100,
            initial: searchPrice.initial / 100,
            currency: searchPrice.currency?.trim().toUpperCase() || null,
          },
          localCurrency,
        )
      : { currentInr: null, retailInr: null };

  const sameApp = previous?.steamAppId === appId;
  const isFree = store?.isFree ?? (sameApp ? previous?.isFree : undefined);
  // A free app has no store low; one found on an old quote was borrowed from
  // another product by the edition backfill.
  const lowestInr =
    !isFree && sameApp && previous?.lowestInr != null && previous.lowestInr > 0
      ? previous.lowestInr
      : null;
  if (isFree) {
    amounts.currentInr = null;
    amounts.retailInr = null;
  }
  const usd = amounts.usd ?? (sameApp ? previous?.usd : undefined);

  return {
    title: name,
    steamAppId: appId,
    itadId: sameApp ? (previous?.itadId ?? null) : null,
    currency: localCurrency,
    currentInr: amounts.currentInr,
    lowestInr,
    retailInr: amounts.retailInr,
    ...(usd ? { usd } : {}),
    ...(isFree != null ? { isFree } : {}),
    currentUsd: null,
    lowestUsd: null,
    retailUsd: null,
    onSale:
      amounts.retailInr != null && amounts.currentInr != null
        ? amounts.currentInr < amounts.retailInr
        : false,
    source: lowestInr != null ? "steam+itad" : "steam",
    updatedAt: nowIso,
    // A carried-over low keeps the time it was last verified, so re-reading
    // the Steam price cannot make an old low look freshly checked.
    itadCheckedAt: sameApp
      ? (previous?.itadCheckedAt ??
        (lowestInr != null ? previous?.updatedAt : null) ??
        null)
      : null,
  };
}

let refreshChain: Promise<unknown> = Promise.resolve();

export type RefreshPricesOptions = {
  force?: boolean;
  limit?: number;
  /**
   * When true (default if ITAD key present): only resolve missing Steam app ids,
   * then bulk-ITAD current+lowest. Much fewer / faster requests.
   */
  itadFastPath?: boolean;
  /** Called after each title finishes (and once at start with done=0). */
  onProgress?: (progress: { done: number; total: number }) => void | Promise<void>;
};

export async function refreshPricesForTitles(
  titles: string[],
  opts?: RefreshPricesOptions,
): Promise<PriceCache> {
  // Offline: no crawl, no write — hand back the cache as it is on disk.
  if (isOffline()) return loadPriceCache();
  const run = refreshChain.then(() =>
    refreshPricesForTitlesUnlocked(titles, opts),
  );
  refreshChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** `null` = nothing learned (failure / timeout); keep the existing quote. */
async function refreshOneTitleGuarded(
  title: string,
  previous?: GamePriceQuote,
): Promise<GamePriceQuote | null> {
  const TITLE_TIMEOUT_MS = 45_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      refreshOneTitle(title, previous),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Title refresh timed out: ${title}`)),
          TITLE_TIMEOUT_MS,
        );
      }),
    ]);
  } catch (err) {
    if (err instanceof ItadRateLimitError) throw err;
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Per run: how many already-resolved quotes get a one-off `is_free` check
 * (one Steam appdetails request each; `is_free` is only learned from Steam).
 *
 * 150: the Steam store API is widely reported to allow about 200 appdetails
 * requests per 5 minutes per IP. 150 leaves room for the title searches of the
 * same run, covers a typical library (100–200 titles) in one weekly run and a
 * larger one in two, and at the limiter's 110 ms spacing adds about 17 s.
 */
export const IS_FREE_BACKFILL_PER_RUN = 150;

async function refreshPricesForTitlesUnlocked(
  titles: string[],
  opts?: RefreshPricesOptions,
): Promise<PriceCache> {
  let cache = await loadPriceCache();
  const { cache: regionCache } = await resolveAndApplyStoreRegion(cache);
  cache = regionCache;
  const limit = opts?.limit ?? 200;
  const itadOn = await hasItadApiKey();

  const queue: string[] = [];
  for (const title of titles) {
    if (queue.length >= limit) break;
    const key = normTitle(title);
    const existing = cache.quotes[key];

    if (!opts?.force) {
      if (itadOn) {
        // Only skip when we already have a fresh store low. Missing lows retry.
        if (isQuoteLatestStoreLow(existing) && quoteHasStoreLow(existing)) {
          continue;
        }
      } else if (
        isWithinTtl(existing?.updatedAt) &&
        existing?.steamAppId != null &&
        existing.retailInr != null
      ) {
        continue;
      }
    }
    queue.push(title);
  }

  const total = queue.length;
  await opts?.onProgress?.({ done: 0, total });

  // 1) Steam. With an ITAD key, resolved titles skip Steam entirely (prices/v3
  //    supplies current + lowest). Without a key Steam is the only source, so
  //    every queued title is re-read — otherwise prices would never change
  //    while the cache kept being stamped fresh.
  let completed = 0;
  // Quotes that actually received data this run.
  let refreshed = 0;
  let isFreeBudget = IS_FREE_BACKFILL_PER_RUN;
  const needSteam: string[] = [];
  for (const title of queue) {
    const key = normTitle(title);
    const existing = cache.quotes[key];
    const resolved =
      existing?.steamAppId != null && existing.source !== "unresolved";
    // `is_free` is only learned from Steam; ask once for old quotes, a few
    // per run, so free titles stop borrowing another edition's price.
    const learnIsFree =
      resolved && existing.isFree === undefined && isFreeBudget > 0;
    if (itadOn && resolved && !learnIsFree) {
      completed += 1;
      continue;
    }
    if (itadOn && learnIsFree) isFreeBudget -= 1;
    needSteam.push(title);
  }
  await opts?.onProgress?.({ done: completed, total });

  if (needSteam.length) {
    await mapPool(needSteam, TITLE_CONCURRENCY, async (title) => {
      const key = normTitle(title);
      const quote = await refreshOneTitleGuarded(title, cache.quotes[key]);
      if (quote) {
        cache.quotes[key] = quote;
        refreshed += 1;
      }
      completed += 1;
      await opts?.onProgress?.({ done: completed, total });
      if (refreshed > 0 && completed % CHECKPOINT_EVERY === 0) {
        cache.updatedAt = new Date().toISOString();
        await savePriceCache(cache);
      }
    });
  }

  // 2) Bulk ITAD: ≤1 lookup (missing itadIds) + 1 prices/v3 for the whole queue
  if (itadOn && queue.length) {
    refreshed += await enrichWithItadStoreLows(cache, queue);
  }

  // Stamp the cache only when something was really fetched: a run with no key,
  // or with every request failing, must not make stale prices look fresh.
  if (refreshed > 0) cache.updatedAt = new Date().toISOString();
  await savePriceCache(cache);
  await opts?.onProgress?.({ done: total, total });
  return cache;
}
