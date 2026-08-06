/**
 * Resolve Steam library/header art. Newer titles use content-hash CDN paths
 * that 404 on the legacy /apps/{id}/library_600x900.jpg URL.
 */
import fs from "node:fs/promises";
import { dataPath, ensureDataDir } from "@/lib/data/load-local";
import {
  steamCapsuleUrl,
  steamHeaderUrl,
  steamLibraryCapsuleUrl,
} from "@/lib/steam/artwork";

export type ArtworkUrls = {
  library: string;
  header: string;
  capsule: string;
  /** True when GetItems returned hashed asset paths */
  hashed: boolean;
  updatedAt: string;
};

export type ArtworkCache = {
  /** Bump to invalidate stale capsule URL preference. */
  version?: number;
  updatedAt: string;
  byAppId: Record<string, ArtworkUrls>;
};

const CACHE_FILE = "artwork-cache.json";
const CACHE_VERSION = 2;
const CDN = "https://shared.akamai.steamstatic.com/store_item_assets/";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

type StoreAssets = {
  asset_url_format?: string;
  library_capsule?: string;
  library_capsule_2x?: string;
  header?: string;
  header_2x?: string;
  main_capsule?: string;
  main_capsule_2x?: string;
  small_capsule?: string;
  small_capsule_2x?: string;
};

function legacyUrls(appId: number): ArtworkUrls {
  return {
    library: steamLibraryCapsuleUrl(appId),
    header: steamHeaderUrl(appId),
    capsule: steamCapsuleUrl(appId),
    hashed: false,
    updatedAt: new Date().toISOString(),
  };
}

function buildFromFormat(format: string, filename: string): string {
  const path = format.replace("${FILENAME}", filename).split("?")[0];
  return `${CDN}${path}`;
}

function urlsFromAssets(appId: number, assets: StoreAssets): ArtworkUrls {
  const format = assets.asset_url_format;
  if (!format) return legacyUrls(appId);

  const libraryFile =
    assets.library_capsule_2x ||
    assets.library_capsule ||
    null;
  const headerFile = assets.header_2x || assets.header || null;
  // Horizontal thumbs use 231×87 — prefer small_capsule over wide 616×353
  const capsuleFile =
    assets.small_capsule_2x ||
    assets.small_capsule ||
    assets.main_capsule_2x ||
    assets.main_capsule ||
    headerFile;

  return {
    library: libraryFile
      ? buildFromFormat(format, libraryFile)
      : steamLibraryCapsuleUrl(appId),
    header: headerFile
      ? buildFromFormat(format, headerFile)
      : steamHeaderUrl(appId),
    capsule: capsuleFile
      ? buildFromFormat(format, capsuleFile)
      : steamCapsuleUrl(appId),
    hashed: Boolean(libraryFile || headerFile || capsuleFile),
    updatedAt: new Date().toISOString(),
  };
}

export async function loadArtworkCache(): Promise<ArtworkCache> {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(dataPath(CACHE_FILE), "utf8");
    return JSON.parse(raw) as ArtworkCache;
  } catch {
    return { version: CACHE_VERSION, updatedAt: "", byAppId: {} };
  }
}

async function saveArtworkCache(cache: ArtworkCache) {
  await ensureDataDir();
  await fs.writeFile(dataPath(CACHE_FILE), JSON.stringify(cache, null, 2));
}

async function fetchStoreAssets(
  appIds: number[],
): Promise<Map<number, StoreAssets>> {
  const out = new Map<number, StoreAssets>();
  if (!appIds.length) return out;

  const chunkSize = 50;
  for (let i = 0; i < appIds.length; i += chunkSize) {
    const chunk = appIds.slice(i, i + chunkSize);
    const input = {
      ids: chunk.map((appid) => ({ appid })),
      context: { language: "english", country_code: "US" },
      data_request: { include_assets: true },
    };
    const url = new URL(
      "https://api.steampowered.com/IStoreBrowseService/GetItems/v1/",
    );
    url.searchParams.set("input_json", JSON.stringify(input));
    try {
      const res = await fetch(url.toString(), {
        headers: { "User-Agent": "steam-stats-local/0.1" },
        cache: "no-store",
      });
      if (!res.ok) continue;
      const data = (await res.json()) as {
        response?: {
          store_items?: { appid?: number; assets?: StoreAssets }[];
        };
      };
      for (const item of data.response?.store_items ?? []) {
        if (item.appid != null && item.assets) {
          out.set(item.appid, item.assets);
        }
      }
    } catch {
      // keep legacy for this chunk
    }
  }
  return out;
}

/**
 * Ensure artwork URLs for app IDs. Uses disk cache; refreshes missing/stale via GetItems.
 */
export async function resolveArtworkForAppIds(
  appIds: number[],
  opts?: { force?: boolean },
): Promise<Record<string, ArtworkUrls>> {
  const unique = [...new Set(appIds.filter((id) => id > 0))];
  const cache = await loadArtworkCache();
  const versionStale = cache.version !== CACHE_VERSION;
  const now = Date.now();
  const needFetch: number[] = [];

  for (const id of unique) {
    const key = String(id);
    const existing = cache.byAppId[key];
    const age = existing?.updatedAt
      ? now - Date.parse(existing.updatedAt)
      : Infinity;
    if (
      !opts?.force &&
      !versionStale &&
      existing &&
      age < MAX_AGE_MS
    ) {
      continue;
    }
    needFetch.push(id);
  }

  if (needFetch.length) {
    const assets = await fetchStoreAssets(needFetch);
    for (const id of needFetch) {
      const a = assets.get(id);
      cache.byAppId[String(id)] = a ? urlsFromAssets(id, a) : legacyUrls(id);
    }
    cache.version = CACHE_VERSION;
    cache.updatedAt = new Date().toISOString();
    await saveArtworkCache(cache);
  } else if (versionStale) {
    cache.version = CACHE_VERSION;
    await saveArtworkCache(cache);
  }

  const result: Record<string, ArtworkUrls> = {};
  for (const id of unique) {
    result[String(id)] =
      cache.byAppId[String(id)] ?? legacyUrls(id);
  }
  return result;
}

export function artworkFor(
  map: Record<string, ArtworkUrls> | undefined,
  appId: number | null | undefined,
): ArtworkUrls | null {
  if (appId == null || appId <= 0) return null;
  return map?.[String(appId)] ?? legacyUrls(appId);
}
