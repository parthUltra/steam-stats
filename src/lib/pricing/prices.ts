import fs from "node:fs/promises";
import {
  itadRateLimiter,
  mapPool,
  steamRateLimiter,
} from "@/lib/async/pool";
import { dataPath, ensureDataDir } from "@/lib/data/load-local";
import { resolveItadApiKey } from "@/lib/pricing/itad-credentials";
import {
  resolveStoreRegionFromAccount,
  type StoreRegion,
} from "@/lib/pricing/store-region";
import {
  stripEditionNoise,
  titlesSoftMatch,
} from "@/lib/analytics/acquisition";

export type GamePriceQuote = {
  title: string;
  steamAppId: number | null;
  /** Cached IsThereAnyDeal game UUID (avoids repeated lookup calls) */
  itadId?: string | null;
  /** @deprecated CheapShark USD low — not used for shelf lowest anymore */
  lowestUsd: number | null;
  currentUsd: number | null;
  /**
   * Live Steam store price in the active store currency
   * (field name is historical; value matches PriceCache.currency).
   */
  currentInr: number | null;
  /**
   * Steam store all-time low via IsThereAnyDeal for the active country
   * (field name is historical; value matches PriceCache.currency).
   */
  lowestInr: number | null;
  /**
   * Steam store list / MSRP in the active store currency
   * (field name is historical; value matches PriceCache.currency).
   */
  retailInr: number | null;
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
  updatedAt: string;
  /** ISO country used for Steam cc + ITAD country */
  country?: string;
  /** ISO currency for currentInr / lowestInr / retailInr amounts */
  currency?: string;
  quotes: Record<string, GamePriceQuote>;
};

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

export function getActiveStoreRegion(): StoreRegion {
  return activeStoreRegion;
}

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
): Promise<PriceCache> {
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
      q.itadCheckedAt = null;
      if (q.source === "steam+itad" || q.source === "steam+itad+cheapshark") {
        q.source = "steam";
      }
    }
    cache.updatedAt = new Date().toISOString();
    await savePriceCache(cache);
  } else if (prevCc == null || prevCur == null || changed) {
    // Persist newly detected region (or currency fill-in) without wiping quotes
    await savePriceCache(cache);
  }

  return cache;
}

export async function resolveAndApplyStoreRegion(
  cache?: PriceCache,
): Promise<{ region: StoreRegion; cache: PriceCache }> {
  const loaded = cache ?? (await loadPriceCache());
  const region = await resolveStoreRegionFromAccount({
    cachedCountry: loaded.country,
    cachedCurrency: loaded.currency,
  });
  await applyStoreRegionToCache(loaded, region);
  return { region, cache: loaded };
}

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/™|®/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSource(
  source: string | undefined,
): GamePriceQuote["source"] {
  if (source === "steam+itad+cheapshark") return "steam+itad+cheapshark";
  if (source === "steam+itad") return "steam+itad";
  if (source === "steam+cheapshark") return "steam+cheapshark";
  if (source === "unresolved") return "unresolved";
  if (source?.includes("itad") && source?.includes("cheapshark"))
    return "steam+itad+cheapshark";
  if (source?.includes("itad")) return "steam+itad";
  if (source?.includes("cheapshark")) return "steam+cheapshark";
  if (source === "steam" || source?.includes("steam")) return "steam";
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

/** @deprecated Prefer `isWithinTtl` (weekly). Kept for callers that mean calendar-day. */
export function isQuoteLatestToday(
  updatedAt: string | null | undefined,
  now = new Date(),
): boolean {
  if (!updatedAt) return false;
  const t = Date.parse(updatedAt);
  if (!Number.isFinite(t)) return false;
  const d = new Date(t);
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

/** Has a real Steam store hist low (ITAD) for the active country. */
export function quoteHasStoreLow(
  quote: Pick<GamePriceQuote, "lowestInr"> | null | undefined,
): boolean {
  return quote != null && quote.lowestInr != null && quote.lowestInr > 0;
}

/** @deprecated Prefer quoteHasStoreLow */
export const quoteHasIndiaLow = quoteHasStoreLow;

/**
 * Quote is “fresh” for the weekly bar: ITAD was checked within 7 days
 * (with or without a store low — DLC/missing rows still settle).
 */
export function isQuoteLatestStoreLow(
  quote:
    | Pick<GamePriceQuote, "updatedAt" | "lowestInr" | "itadCheckedAt">
    | null
    | undefined,
  now = new Date(),
): boolean {
  if (!quote) return false;
  const stamp =
    quote.itadCheckedAt || (quoteHasStoreLow(quote) ? quote.updatedAt : null);
  return isWithinTtl(stamp, PRICE_CACHE_TTL_MS, now.getTime());
}

/** @deprecated Prefer isQuoteLatestStoreLow */
export const isQuoteLatestIndiaLow = isQuoteLatestStoreLow;

/** How many library titles have a fresh (≤7 day) ITAD check stored. */
export function countLatestQuotes(
  titles: string[],
  cache: Pick<PriceCache, "quotes">,
  now = new Date(),
): { latest: number; total: number } {
  const total = titles.length;
  let latest = 0;
  for (const title of titles) {
    const q = cache.quotes[normalizeTitle(title)];
    if (isQuoteLatestStoreLow(q, now)) latest += 1;
  }
  return { latest, total };
}

/**
 * Oldest / unchecked titles first. Optionally skip titles still fresh this week.
 */
export function pickOldestTitles(
  titles: string[],
  cache: Pick<PriceCache, "quotes">,
  opts?: { limit?: number; skipLatestToday?: boolean; now?: Date },
): string[] {
  const now = opts?.now ?? new Date();
  const limit = opts?.limit ?? titles.length;
  const ranked = titles
    .map((title) => {
      const q = cache.quotes[normalizeTitle(title)];
      const stamp = q?.itadCheckedAt || q?.updatedAt;
      const ts = stamp ? Date.parse(stamp) : 0;
      const hasLow = quoteHasStoreLow(q);
      const rankTs = Number.isFinite(ts) ? ts : 0;
      return {
        title,
        ts: rankTs,
        latest: isQuoteLatestStoreLow(q, now),
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

/** True when cache.updatedAt is within the weekly TTL. */
export function isPriceCacheFresh(
  cache: Pick<PriceCache, "updatedAt">,
  now = Date.now(),
): boolean {
  return isWithinTtl(cache.updatedAt, PRICE_CACHE_TTL_MS, now);
}

/** Library store lows are fresh for this week (all titles checked ≤7 days). */
export function isStoreLowsWeekFresh(
  titles: string[],
  cache: Pick<PriceCache, "quotes">,
  now = new Date(),
): boolean {
  if (!titles.length) return true;
  const { latest, total } = countLatestQuotes(titles, cache, now);
  return total > 0 && latest >= total;
}

/** @deprecated Prefer isStoreLowsWeekFresh */
export const isIndiaLowsWeekFresh = isStoreLowsWeekFresh;

export function priceCacheAgeMs(
  cache: Pick<PriceCache, "updatedAt">,
  now = Date.now(),
): number | null {
  if (!cache.updatedAt) return null;
  const t = Date.parse(cache.updatedAt);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, now - t);
}

export async function loadPriceCache(): Promise<PriceCache> {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(dataPath(CACHE_FILE), "utf8");
    const cache = JSON.parse(raw) as PriceCache;
    for (const q of Object.values(cache.quotes ?? {})) {
      q.source = normalizeSource(q.source);
      if (q.lowestInr === undefined) q.lowestInr = null;
      if (
        q.lowestUsd != null &&
        q.currentUsd != null &&
        q.currentUsd > 0 &&
        q.lowestUsd >= q.currentUsd * 0.98
      ) {
        q.lowestUsd = null;
        if (q.source === "steam+cheapshark") q.source = "steam";
        if (q.source === "steam+itad+cheapshark") q.source = "steam+itad";
      }
    }
    return cache;
  } catch {
    return { updatedAt: "", quotes: {} };
  }
}

export async function savePriceCache(cache: PriceCache) {
  await ensureDataDir();
  await fs.writeFile(dataPath(CACHE_FILE), JSON.stringify(cache, null, 2));
}

async function fetchJson<T>(
  url: string,
  init?: RequestInit & { itad?: boolean },
): Promise<T | null> {
  try {
    const { itad, ...rest } = init ?? {};
    const res = await fetch(url, {
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

async function steamStoreSearchItems(
  term: string,
  cc: string,
): Promise<StoreSearchItem[]> {
  const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&l=english&cc=${cc}`;
  const data = await steamRateLimiter.schedule(() =>
    fetchJson<{ total: number; items: StoreSearchItem[] }>(url),
  );
  return data?.items ?? [];
}

async function steamStoreSearch(title: string): Promise<StoreSearchItem | null> {
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
    if (!items.length) continue;

    const apps = items.filter((i) => i.type === "app");
    const pool = apps.length ? apps : items;
    const norm = normalizeTitle(title);
    const loose = (t: string) =>
      normalizeTitle(t)
        .replace(/[-–—:]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    const looseNorm = loose(title);

    const hit =
      pool.find((g) => normalizeTitle(g.name) === norm) ??
      pool.find((g) => loose(g.name) === looseNorm) ??
      pool.find((g) => normalizeTitle(g.name).startsWith(norm)) ??
      pool.find((g) => normalizeTitle(g.name).includes(norm)) ??
      pool.find((g) => norm.includes(normalizeTitle(g.name))) ??
      pool[0] ??
      null;
    if (hit) return hit;
  }

  return null;
}

/** Prefer remasters / currently listed editions when the owned SKU is unlisted. */
function editionProxyRank(name: string): number {
  const n = normalizeTitle(name);
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
    const items = await steamStoreSearchItems(q, cc);
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

  for (const c of candidates) {
    const overview = await steamPriceOverview(c.id, cc);
    if (overview?.final != null && overview.final > 0) {
      return {
        appId: c.id,
        name: c.name,
        currentInr: overview.final,
        retailInr: overview.initial ?? null,
      };
    }
    if (c.price?.final != null && c.price.final > 0) {
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

async function steamPriceOverview(
  appId: number,
  cc: string,
): Promise<{ final: number; initial: number } | null> {
  const url = `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=${cc}&filters=price_overview`;
  const data = await steamRateLimiter.schedule(() =>
    fetchJson<
      Record<
        string,
        {
          success?: boolean;
          data?: {
            price_overview?: { final?: number; initial?: number };
          };
        }
      >
    >(url),
  );
  const entry = data?.[String(appId)];
  if (!entry?.success) return null;
  const overview = entry.data?.price_overview;
  if (!overview || overview.final == null) return null;
  const final = overview.final / 100;
  const initial =
    overview.initial != null ? overview.initial / 100 : final;
  return { final, initial };
}

async function steamPrice(appId: number, cc: string): Promise<number | null> {
  const overview = await steamPriceOverview(appId, cc);
  return overview?.final ?? null;
}

/**
 * Bulk Steam appid → ITAD id via POST /lookup/id/shop/61/v1
 * Body: ["app/123", ...] — one request for many games (not /games/lookup/v1).
 */
async function itadBulkLookupSteamAppIds(
  appIds: number[],
): Promise<Map<number, string | null>> {
  const out = new Map<number, string | null>();
  if (!appIds.length) return out;
  const key = await resolveItadApiKey();
  if (!key) return out;

  const unique = [...new Set(appIds.filter((id) => id > 0))];
  const CHUNK = 100;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    const body = chunk.map((id) => `app/${id}`);
    const map = await itadRateLimiter.schedule(() =>
      fetchJson<Record<string, string | null>>(
        `https://api.isthereanydeal.com/lookup/id/shop/${ITAD_STEAM_SHOP}/v1?key=${encodeURIComponent(key)}`,
        {
          itad: true,
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      ),
    );
    for (const id of chunk) {
      const raw = map?.[`app/${id}`];
      out.set(id, typeof raw === "string" && raw.length > 0 ? raw : null);
    }
  }
  return out;
}

/**
 * Bulk Steam current + store-low via POST /games/prices/v3
 * (active country, shops=61). One request covers up to 200 games.
 */
async function itadBulkSteamStorePrices(itadIds: string[]): Promise<
  Map<
    string,
    {
      currentInr: number | null;
      retailInr: number | null;
      lowestInr: number | null;
    }
  >
> {
  const out = new Map<
    string,
    {
      currentInr: number | null;
      retailInr: number | null;
      lowestInr: number | null;
    }
  >();
  if (!itadIds.length) return out;
  const key = await resolveItadApiKey();
  if (!key) return out;

  const country = itadCountry();
  const unique = [...new Set(itadIds.filter(Boolean))];
  const CHUNK = 200;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    const rows = await itadRateLimiter.schedule(() =>
      fetchJson<
        Array<{
          id?: string;
          historyLow?: { all?: { amount?: number } };
          deals?: Array<{
            shop?: { id?: number };
            price?: { amount?: number };
            regular?: { amount?: number };
            storeLow?: { amount?: number };
            cut?: number;
          }>;
        }>
      >(
        `https://api.isthereanydeal.com/games/prices/v3?key=${encodeURIComponent(key)}&country=${encodeURIComponent(country)}&shops=${ITAD_STEAM_SHOP}`,
        {
          itad: true,
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(chunk),
        },
      ),
    );
    const byId = new Map(
      (Array.isArray(rows) ? rows : []).map((r) => [r.id, r] as const),
    );
    for (const id of chunk) {
      const entry = byId.get(id);
      const steam =
        entry?.deals?.find((d) => d.shop?.id === ITAD_STEAM_SHOP) ??
        entry?.deals?.[0];
      const current = steam?.price?.amount;
      const retail = steam?.regular?.amount;
      const storeLow = steam?.storeLow?.amount;
      const histLow = entry?.historyLow?.all?.amount;
      const low =
        storeLow != null && storeLow > 0
          ? storeLow
          : histLow != null && histLow > 0
            ? histLow
            : null;
      out.set(id, {
        currentInr: current != null && current > 0 ? current : null,
        retailInr: retail != null && retail > 0 ? retail : null,
        lowestInr: low,
      });
    }
  }
  return out;
}

/** @deprecated */
const itadBulkSteamIndiaPrices = itadBulkSteamStorePrices;

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
  const keys = [...new Set(titles.map(normalizeTitle))];
  const proxyAppsNeeded: { key: string; appId: number }[] = [];

  for (const key of keys) {
    const q = cache.quotes[key];
    if (!q) continue;
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
    : new Map<string, number | null>();

  for (const p of withItad) {
    const q = cache.quotes[p.key];
    if (!q || (q.lowestInr != null && q.lowestInr > 0)) continue;
    const row = prices.get(p.itadId);
    const low = row?.lowestInr ?? storeLows.get(p.itadId) ?? null;
    if (low == null || low <= 0) continue;
    q.lowestInr = low;
    q.source = "steam+itad";
    q.itadCheckedAt = new Date().toISOString();
    q.updatedAt = q.itadCheckedAt;
  }
}

/**
 * Bulk Steam store-lows via POST /games/storelow/v2.
 * Used when prices/v3 returns current but no storeLow / historyLow.
 */
async function itadBulkSteamStoreLows(
  itadIds: string[],
): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  if (!itadIds.length) return out;
  const key = await resolveItadApiKey();
  if (!key) return out;

  const country = itadCountry();
  const unique = [...new Set(itadIds.filter(Boolean))];
  const CHUNK = 200;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    const lows = await itadRateLimiter.schedule(() =>
      fetchJson<
        Array<{
          id?: string;
          lows?: Array<{
            shop?: { id?: number };
            price?: { amount?: number };
          }>;
        }>
      >(
        `https://api.isthereanydeal.com/games/storelow/v2?key=${encodeURIComponent(key)}&country=${encodeURIComponent(country)}&shops=${ITAD_STEAM_SHOP}`,
        {
          itad: true,
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(chunk),
        },
      ),
    );
    const byId = new Map(
      (Array.isArray(lows) ? lows : []).map((r) => [r.id, r] as const),
    );
    for (const id of chunk) {
      const entry = byId.get(id);
      const steamLow =
        entry?.lows?.find((l) => l.shop?.id === ITAD_STEAM_SHOP) ??
        entry?.lows?.[0];
      const amount = steamLow?.price?.amount;
      out.set(id, amount != null && amount > 0 ? amount : null);
    }
  }
  return out;
}

/** @deprecated */
const itadBulkSteamIndiaStoreLows = itadBulkSteamStoreLows;

/**
 * Apply store current + hist lows using minimal ITAD traffic:
 * - 0–1 bulk shop lookups (only for titles missing cached itadId)
 * - 1 bulk prices/v3 call per ≤200 games (current + Steam store low)
 * - 1 bulk storelow/v2 for any still missing a low
 * Reuses cached itadId. Re-fetches when a title has no store low yet
 * (even if it was “checked” this week).
 */
async function enrichWithItadStoreLows(
  cache: PriceCache,
  titles: string[],
): Promise<void> {
  if (!(await hasItadApiKey())) return;

  const nowIso = new Date().toISOString();
  const keys = titles.map(normalizeTitle);
  const need: { key: string; appId: number; itadId: string | null }[] = [];

  for (const key of keys) {
    const q = cache.quotes[key];
    if (!q) continue;
    // Keep existing lows that are still within the weekly TTL.
    // Titles checked but still missing a low are retried.
    if (quoteHasStoreLow(q) && isQuoteLatestStoreLow(q)) continue;
    if (q.steamAppId == null) {
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
  if (!need.length) return;

  const missingLookup = [
    ...new Set(need.filter((n) => !n.itadId).map((n) => n.appId)),
  ];
  if (missingLookup.length) {
    const looked = await itadBulkLookupSteamAppIds(missingLookup);
    for (const n of need) {
      if (n.itadId) continue;
      const id = looked.get(n.appId) ?? null;
      n.itadId = id;
      const q = cache.quotes[n.key];
      if (q) q.itadId = id;
    }
  }

  const withItad = need.filter((n) => n.itadId) as {
    key: string;
    appId: number;
    itadId: string;
  }[];
  const withoutItad = need.filter((n) => !n.itadId);

  for (const n of withoutItad) {
    const q = cache.quotes[n.key];
    if (!q) continue;
    q.itadCheckedAt = nowIso;
    q.updatedAt = nowIso;
  }

  if (withItad.length) {
    const prices = await itadBulkSteamStorePrices(
      withItad.map((n) => n.itadId),
    );
    const stillNeedLow = withItad.filter((n) => {
      const row = prices.get(n.itadId);
      return row?.lowestInr == null;
    });
    const storeLows = stillNeedLow.length
      ? await itadBulkSteamStoreLows(stillNeedLow.map((n) => n.itadId))
      : new Map<string, number | null>();

    for (const n of withItad) {
      const q = cache.quotes[n.key];
      if (!q) continue;
      const row = prices.get(n.itadId);
      const storeLow = storeLows.get(n.itadId) ?? null;
      const lowestInr = row?.lowestInr ?? storeLow;
      if (lowestInr != null) {
        q.lowestInr = lowestInr;
      }
      if (row?.currentInr != null) {
        q.currentInr = row.currentInr;
      }
      if (row?.retailInr != null) {
        q.retailInr = row.retailInr;
      }
      if (q.currentInr != null && q.retailInr != null) {
        q.onSale = q.currentInr < q.retailInr;
      }
      if (quoteHasStoreLow(q) || row || storeLow != null) {
        q.source = "steam+itad";
      }
      q.itadId = n.itadId;
      q.itadCheckedAt = nowIso;
      q.updatedAt = nowIso;
    }
  }

  backfillEditionLowsFromRelated(cache);
  await backfillUnlistedFromAvailableEditions(cache, titles);
}

/** @deprecated */
const enrichWithItadIndiaLows = enrichWithItadStoreLows;

function unresolvedQuote(
  title: string,
  opts?: { itadCheckedAt?: string | null },
): GamePriceQuote {
  return {
    title,
    steamAppId: null,
    itadId: null,
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

/** Steam live quotes only — no ITAD calls (ITAD is applied in bulk after). */
async function refreshOneTitle(
  title: string,
  previous?: GamePriceQuote,
): Promise<GamePriceQuote> {
  const itadOn = await hasItadApiKey();
  try {
    const hit = await steamStoreSearch(title);
    if (!hit) {
      return unresolvedQuote(title, {
        itadCheckedAt: itadOn
          ? new Date().toISOString()
          : previous?.itadCheckedAt,
      });
    }

    const currentUsd =
      hit.price != null
        ? hit.price.final / 100
        : await steamPrice(hit.id, "us");

    const localOverview = await steamPriceOverview(hit.id, steamCc());
    const currentInr = localOverview?.final ?? null;
    const retailInr = localOverview?.initial ?? null;
    const retailUsd =
      hit.price != null ? hit.price.initial / 100 : currentUsd;

    const sameApp = previous?.steamAppId === hit.id;
    const lowestInr =
      sameApp && previous?.lowestInr != null && previous.lowestInr > 0
        ? previous.lowestInr
        : null;
    const lowestUsd = sameApp ? (previous?.lowestUsd ?? null) : null;
    const itadId = sameApp ? (previous?.itadId ?? null) : null;

    return {
      title: hit.name,
      steamAppId: hit.id,
      itadId,
      currentUsd,
      lowestUsd,
      currentInr,
      lowestInr,
      retailInr,
      retailUsd,
      onSale:
        retailInr != null && currentInr != null
          ? currentInr < retailInr
          : retailUsd != null && currentUsd != null
            ? currentUsd < retailUsd
            : false,
      source: lowestInr != null ? "steam+itad" : "steam",
      updatedAt: new Date().toISOString(),
      itadCheckedAt: sameApp ? (previous?.itadCheckedAt ?? null) : null,
    };
  } catch (err) {
    if (err instanceof ItadRateLimitError) throw err;
    return previous ?? unresolvedQuote(title);
  }
}

let refreshChain: Promise<unknown> = Promise.resolve();

/** Clear a stuck refresh mutex after a batch timeout. */
export function resetPriceRefreshChain() {
  refreshChain = Promise.resolve();
}

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
  const run = refreshChain.then(() =>
    refreshPricesForTitlesUnlocked(titles, opts),
  );
  refreshChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function refreshOneTitleGuarded(
  title: string,
  previous?: GamePriceQuote,
): Promise<GamePriceQuote> {
  const TITLE_TIMEOUT_MS = 45_000;
  try {
    return await Promise.race([
      refreshOneTitle(title, previous),
      new Promise<GamePriceQuote>((_, reject) => {
        setTimeout(
          () => reject(new Error(`Title refresh timed out: ${title}`)),
          TITLE_TIMEOUT_MS,
        );
      }),
    ]);
  } catch (err) {
    if (err instanceof ItadRateLimitError) throw err;
    return previous ?? unresolvedQuote(title);
  }
}

async function refreshPricesForTitlesUnlocked(
  titles: string[],
  opts?: RefreshPricesOptions,
): Promise<PriceCache> {
  let cache = await loadPriceCache();
  const { cache: regionCache } = await resolveAndApplyStoreRegion(cache);
  cache = regionCache;
  const limit = opts?.limit ?? 200;
  const itadOn = await hasItadApiKey();
  const fastPath = opts?.itadFastPath ?? itadOn;

  const queue: string[] = [];
  for (const title of titles) {
    if (queue.length >= limit) break;
    const key = normalizeTitle(title);
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

  // 1) Only resolve Steam app ids when missing — skip live Steam price fetches
  //    on the fast path (ITAD prices/v3 supplies current + lowest).
  let completed = 0;
  const needSteam: string[] = [];
  for (const title of queue) {
    const key = normalizeTitle(title);
    const existing = cache.quotes[key];
    if (existing?.steamAppId != null && existing.source !== "unresolved") {
      completed += 1;
      continue;
    }
    needSteam.push(title);
  }
  await opts?.onProgress?.({ done: completed, total });

  if (needSteam.length) {
    await mapPool(needSteam, TITLE_CONCURRENCY, async (title) => {
      const key = normalizeTitle(title);
      const quote = await refreshOneTitleGuarded(title, cache.quotes[key]);
      // On fast path we only need the app id; live store price comes from ITAD next
      cache.quotes[key] = quote;
      completed += 1;
      await opts?.onProgress?.({ done: completed, total });
      if (completed % CHECKPOINT_EVERY === 0) {
        cache.updatedAt = new Date().toISOString();
        await savePriceCache(cache);
      }
    });
  }

  // 2) Bulk ITAD: ≤1 lookup (missing itadIds) + 1 prices/v3 for the whole queue
  if (itadOn && queue.length) {
    await enrichWithItadStoreLows(cache, queue);
  } else if (!fastPath && !itadOn && needSteam.length === 0) {
    // No ITAD and all had app ids — still nothing to do for weekly lows
  }

  cache.updatedAt = new Date().toISOString();
  await savePriceCache(cache);
  await opts?.onProgress?.({ done: total, total });
  return cache;
}
