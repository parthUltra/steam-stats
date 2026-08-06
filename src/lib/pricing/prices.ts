import fs from "node:fs/promises";
import { dataPath, ensureDataDir } from "@/lib/data/load-local";

export type GamePriceQuote = {
  title: string;
  steamAppId: number | null;
  currentUsd: number | null;
  lowestUsd: number | null;
  currentInr: number | null;
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
    return JSON.parse(raw) as PriceCache;
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
  const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(title)}&l=english&cc=US`;
  const data = await fetchJson<{ total: number; items: StoreSearchItem[] }>(url);
  if (!data?.items?.length) return null;
  const apps = data.items.filter((i) => i.type === "app");
  const pool = apps.length ? apps : data.items;
  const norm = normalizeTitle(title);
  return (
    pool.find((g) => normalizeTitle(g.name) === norm) ??
    pool.find((g) => normalizeTitle(g.name).startsWith(norm)) ??
    pool.find((g) => normalizeTitle(g.name).includes(norm)) ??
    pool.find((g) => norm.includes(normalizeTitle(g.name))) ??
    pool[0] ??
    null
  );
}

async function steamPrice(appId: number, cc: string): Promise<number | null> {
  const url = `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=${cc}&filters=price_overview`;
  const data = await fetchJson<
    Record<
      string,
      {
        success?: boolean;
        data?: { price_overview?: { final?: number } };
      }
    >
  >(url);
  const entry = data?.[String(appId)];
  if (!entry?.success) return null;
  const overview = entry.data?.price_overview;
  // No price_overview → delisted / unavailable (not a free ₹0 listing)
  if (!overview || overview.final == null) return null;
  return overview.final / 100;
}

type CheapSharkGame = {
  gameID: string;
  steamAppID: string | null;
  cheapest: string;
  external: string;
};

async function cheapSharkLowest(steamAppId: number): Promise<number | null> {
  const list = await fetchJson<CheapSharkGame[]>(
    `https://www.cheapshark.com/api/1.0/games?steamAppID=${steamAppId}&limit=5`,
  );
  if (!list?.length) return null;
  const game =
    list.find((g) => String(g.steamAppID) === String(steamAppId)) ?? list[0];
  const detail = await fetchJson<{
    cheapestPriceEver?: { price?: string };
  }>(`https://www.cheapshark.com/api/1.0/games?id=${game.gameID}`);
  if (detail?.cheapestPriceEver?.price != null) {
    return Number(detail.cheapestPriceEver.price);
  }
  return Number(game.cheapest);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function refreshPricesForTitles(
  titles: string[],
  opts?: { force?: boolean; limit?: number },
): Promise<PriceCache> {
  const cache = await loadPriceCache();
  const now = Date.now();
  const maxAgeMs = 24 * 60 * 60 * 1000;
  const limit = opts?.limit ?? 80;
  let processed = 0;

  for (const title of titles) {
    if (processed >= limit) break;
    const key = normalizeTitle(title);
    const existing = cache.quotes[key];
    if (
      !opts?.force &&
      existing &&
      existing.updatedAt &&
      now - Date.parse(existing.updatedAt) < maxAgeMs &&
      existing.steamAppId
    ) {
      continue;
    }

    processed += 1;
    try {
      const hit = await steamStoreSearch(title);
      await sleep(180);
      if (!hit) {
        cache.quotes[key] = {
          title,
          steamAppId: null,
          currentUsd: null,
          lowestUsd: null,
          currentInr: null,
          retailUsd: null,
          onSale: false,
          source: "unresolved",
          updatedAt: new Date().toISOString(),
        };
        continue;
      }

      const currentUsd =
        hit.price != null
          ? hit.price.final / 100
          : await steamPrice(hit.id, "us");
      await sleep(120);
      const currentInr = await steamPrice(hit.id, "in");
      await sleep(120);
      const lowestUsd = await cheapSharkLowest(hit.id);
      await sleep(150);

      const retailUsd =
        hit.price != null ? hit.price.initial / 100 : currentUsd;

      cache.quotes[key] = {
        title: hit.name,
        steamAppId: hit.id,
        currentUsd,
        lowestUsd: lowestUsd ?? currentUsd,
        currentInr,
        retailUsd,
        onSale:
          retailUsd != null && currentUsd != null
            ? currentUsd < retailUsd
            : false,
        source: lowestUsd != null ? "steam+cheapshark" : "steam",
        updatedAt: new Date().toISOString(),
      };
    } catch {
      cache.quotes[key] = {
        title,
        steamAppId: null,
        currentUsd: null,
        lowestUsd: null,
        currentInr: null,
        retailUsd: null,
        onSale: false,
        source: "unresolved",
        updatedAt: new Date().toISOString(),
      };
    }
  }

  cache.updatedAt = new Date().toISOString();
  await savePriceCache(cache);
  return cache;
}
