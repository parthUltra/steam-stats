import fs from "node:fs/promises";
import {
  cheapSharkRateLimiter,
  mapPool,
  steamRateLimiter,
} from "@/lib/async/pool";
import { dataPath, ensureDataDir } from "@/lib/data/load-local";

export type GamePriceQuote = {
  title: string;
  steamAppId: number | null;
  currentUsd: number | null;
  lowestUsd: number | null;
  currentInr: number | null;
  /** Steam store list price in INR (cc=IN price_overview.initial) — never FX from USD */
  retailInr: number | null;
  retailUsd: number | null;
  onSale: boolean;
  source: "steam+cheapshark" | "steam" | "unresolved";
  updatedAt: string;
};

export type PriceCache = {
  updatedAt: string;
  quotes: Record<string, GamePriceQuote>;
};

const CACHE_FILE = "price-cache.json";
const UA = "steam-stats-local/0.1 (personal; localhost)";
const TITLE_CONCURRENCY = 3;
const CHECKPOINT_EVERY = 10;

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/™|®/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function loadPriceCache(): Promise<PriceCache> {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(dataPath(CACHE_FILE), "utf8");
    const cache = JSON.parse(raw) as PriceCache;
    // Older builds stored currentUsd as lowestUsd when CheapShark failed —
    // that made every title look like "no real hist low". Clear those.
    for (const q of Object.values(cache.quotes ?? {})) {
      if (
        q.lowestUsd != null &&
        q.currentUsd != null &&
        q.currentUsd > 0 &&
        q.lowestUsd >= q.currentUsd * 0.98
      ) {
        q.lowestUsd = null;
        if (q.source === "steam+cheapshark") q.source = "steam";
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

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

type StoreSearchItem = {
  type: string;
  name: string;
  id: number;
  price?: { currency: string; initial: number; final: number };
};

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

    const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&l=english&cc=US`;
    const data = await steamRateLimiter.schedule(() =>
      fetchJson<{ total: number; items: StoreSearchItem[] }>(url),
    );
    if (!data?.items?.length) continue;

    const apps = data.items.filter((i) => i.type === "app");
    const pool = apps.length ? apps : data.items;
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
  // No price_overview → delisted / unavailable (not a free ₹0 listing)
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

type CheapSharkGame = {
  gameID: string;
  steamAppID: string | null;
  cheapest: string;
  external: string;
};

async function cheapSharkLowest(steamAppId: number): Promise<number | null> {
  const list = await cheapSharkRateLimiter.schedule(() =>
    fetchJson<CheapSharkGame[]>(
      `https://www.cheapshark.com/api/1.0/games?steamAppID=${steamAppId}&limit=5`,
    ),
  );
  if (!Array.isArray(list) || !list.length) return null;
  const game =
    list.find((g) => String(g.steamAppID) === String(steamAppId)) ?? list[0];
  if (!game?.gameID) return null;
  const detail = await cheapSharkRateLimiter.schedule(() =>
    fetchJson<{
      cheapestPriceEver?: { price?: string };
    }>(`https://www.cheapshark.com/api/1.0/games?id=${game.gameID}`),
  );
  // Only all-time low — never "cheapest right now" (that equals list for most titles)
  const ever = detail?.cheapestPriceEver?.price;
  if (ever == null || ever === "") return null;
  const n = Number(ever);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function unresolvedQuote(title: string): GamePriceQuote {
  return {
    title,
    steamAppId: null,
    currentUsd: null,
    lowestUsd: null,
    currentInr: null,
    retailInr: null,
    retailUsd: null,
    onSale: false,
    source: "unresolved",
    updatedAt: new Date().toISOString(),
  };
}

async function refreshOneTitle(title: string): Promise<GamePriceQuote> {
  try {
    const hit = await steamStoreSearch(title);
    if (!hit) return unresolvedQuote(title);

    const currentUsd =
      hit.price != null
        ? hit.price.final / 100
        : await steamPrice(hit.id, "us");

    const [inOverview, lowestUsd] = await Promise.all([
      steamPriceOverview(hit.id, "in"),
      cheapSharkLowest(hit.id),
    ]);

    const currentInr = inOverview?.final ?? null;
    const retailInr = inOverview?.initial ?? null;
    const retailUsd =
      hit.price != null ? hit.price.initial / 100 : currentUsd;

    return {
      title: hit.name,
      steamAppId: hit.id,
      currentUsd,
      // null when CheapShark has no all-time low — never copy currentUsd
      lowestUsd,
      currentInr,
      retailInr,
      retailUsd,
      onSale:
        retailInr != null && currentInr != null
          ? currentInr < retailInr
          : retailUsd != null && currentUsd != null
            ? currentUsd < retailUsd
            : false,
      source: lowestUsd != null ? "steam+cheapshark" : "steam",
      updatedAt: new Date().toISOString(),
    };
  } catch {
    return unresolvedQuote(title);
  }
}

let refreshChain: Promise<unknown> = Promise.resolve();

export async function refreshPricesForTitles(
  titles: string[],
  opts?: { force?: boolean; limit?: number },
): Promise<PriceCache> {
  // Serialize refreshes so Strict Mode / overlapping dashboard loads don't
  // stampede Steam with duplicate title queues.
  const run = refreshChain.then(() => refreshPricesForTitlesUnlocked(titles, opts));
  refreshChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function refreshPricesForTitlesUnlocked(
  titles: string[],
  opts?: { force?: boolean; limit?: number },
): Promise<PriceCache> {
  const cache = await loadPriceCache();
  const now = Date.now();
  const maxAgeMs = 24 * 60 * 60 * 1000;
  const limit = opts?.limit ?? 80;

  const queue: string[] = [];
  for (const title of titles) {
    if (queue.length >= limit) break;
    const key = normalizeTitle(title);
    const existing = cache.quotes[key];
    if (
      !opts?.force &&
      existing &&
      existing.updatedAt &&
      now - Date.parse(existing.updatedAt) < maxAgeMs &&
      // Backfill INR list prices once for caches that only had USD retail
      (existing.steamAppId == null || existing.retailInr != null)
    ) {
      continue;
    }
    queue.push(title);
  }

  let completed = 0;
  await mapPool(queue, TITLE_CONCURRENCY, async (title) => {
    const quote = await refreshOneTitle(title);
    cache.quotes[normalizeTitle(title)] = quote;
    completed += 1;
    if (completed % CHECKPOINT_EVERY === 0) {
      cache.updatedAt = new Date().toISOString();
      await savePriceCache(cache);
    }
  });

  cache.updatedAt = new Date().toISOString();
  await savePriceCache(cache);
  return cache;
}
