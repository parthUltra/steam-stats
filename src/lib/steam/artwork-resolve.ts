/**
 * Resolve Steam library/header art. Newer titles use content-hash CDN paths
 * that 404 on the legacy /apps/{id}/library_600x900.jpg URL.
 */
import { readJsonFile, updateJsonFile } from "@/lib/data/json-store";
import { dataPath, ensureDataDir } from "@/lib/data/load-local";
import { isOffline, netFetch } from "@/lib/runtime";
import {
  steamCapsuleUrl,
  steamHeaderUrl,
  steamLibraryCapsuleUrl,
} from "@/lib/steam/artwork";

/** The three image URLs for one app — the shape sent to the client. */
export type ArtworkUrls = {
  library: string;
  header: string;
  capsule: string;
};

/** On-disk cache entry: URLs plus bookkeeping that never leaves the server. */
export type CachedArtworkUrls = ArtworkUrls & {
  /** True when GetItems returned hashed asset paths */
  hashed: boolean;
  updatedAt: string;
};

export type ArtworkCache = {
  /** Bump to invalidate stale capsule URL preference. */
  version?: number;
  updatedAt: string;
  byAppId: Record<string, CachedArtworkUrls>;
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

/** Deterministic legacy CDN paths — the fallback when nothing is cached. */
export function legacyUrls(appId: number): ArtworkUrls {
  return {
    library: steamLibraryCapsuleUrl(appId),
    header: steamHeaderUrl(appId),
    capsule: steamCapsuleUrl(appId),
  };
}

function buildFromFormat(format: string, filename: string): string {
  const path = format.replace("${FILENAME}", filename).split("?")[0];
  return `${CDN}${path}`;
}

function urlsFromAssets(appId: number, assets: StoreAssets): CachedArtworkUrls {
  const format = assets.asset_url_format;
  if (!format) {
    // The store answered but has no hashed assets: legacy paths are the answer.
    return {
      ...legacyUrls(appId),
      hashed: false,
      updatedAt: new Date().toISOString(),
    };
  }

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

const emptyCache = (): ArtworkCache => ({
  version: CACHE_VERSION,
  updatedAt: "",
  byAppId: {},
});

/** Missing file → empty cache; unreadable / corrupt file → throws. */
async function readArtworkCacheStrict(): Promise<ArtworkCache> {
  const parsed = await readJsonFile<ArtworkCache>(dataPath(CACHE_FILE));
  if (!parsed) return emptyCache();
  parsed.byAppId ??= {};
  return parsed;
}

/**
 * Cache read only — no network, no write, no directory creation. This is the
 * request path, and artwork is regenerable, so a corrupt file degrades to the
 * legacy CDN URLs instead of failing the dashboard. (The write path below is
 * strict and will not save over a corrupt file.)
 */
export async function loadArtworkCache(): Promise<ArtworkCache> {
  try {
    return await readArtworkCacheStrict();
  } catch (err) {
    console.warn(err instanceof Error ? err.message : err);
    return emptyCache();
  }
}

/** Entries on disk that are newer than ours (another process wrote them) win. */
function mergeArtworkCaches(mine: ArtworkCache, disk: ArtworkCache): ArtworkCache {
  for (const [id, theirs] of Object.entries(disk.byAppId ?? {})) {
    const ours = mine.byAppId[id];
    if (
      !ours ||
      (Date.parse(theirs.updatedAt) || 0) > (Date.parse(ours.updatedAt) || 0)
    ) {
      mine.byAppId[id] = theirs;
    }
  }
  return mine;
}

/** Atomic, locked, merged with what is on disk. Throws if the file is corrupt. */
async function saveArtworkCache(cache: ArtworkCache) {
  await ensureDataDir();
  await updateJsonFile<ArtworkCache>(dataPath(CACHE_FILE), (disk) =>
    disk ? mergeArtworkCaches(cache, disk) : cache,
  );
}

/**
 * `answered` holds every id whose chunk got a successful store response, so the
 * caller can tell "the store has no assets for this app" (definitive) from
 * "the request failed" (retry later).
 */
async function fetchStoreAssets(appIds: number[]): Promise<{
  assets: Map<number, StoreAssets>;
  answered: Set<number>;
}> {
  const out = new Map<number, StoreAssets>();
  const answered = new Set<number>();
  if (!appIds.length) return { assets: out, answered };

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
      const res = await netFetch(url.toString(), {
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
      for (const id of chunk) answered.add(id);
    } catch {
      // chunk failed — its ids stay unanswered and are retried next run
    }
  }
  return { assets: out, answered };
}

/**
 * Ensure artwork URLs for app IDs. Uses disk cache; refreshes missing/stale via
 * GetItems and writes the cache. Network + write: called from
 * scripts/refresh-prices.ts, never from the request path (which reads
 * `loadArtworkCache()` and falls back to `legacyUrls`).
 */
export async function resolveArtworkForAppIds(
  appIds: number[],
  opts?: { force?: boolean },
): Promise<Record<string, ArtworkUrls>> {
  const unique = [...new Set(appIds.filter((id) => id > 0))];
  const cache = await readArtworkCacheStrict();
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

  if (needFetch.length && !isOffline()) {
    const { assets, answered } = await fetchStoreAssets(needFetch);
    // Persist only ids the store actually answered for. After a failed request
    // (network blip, non-200) the id keeps its previous entry, or stays absent,
    // so it is retried next run instead of pinning legacy URLs for a week.
    let resolved = 0;
    for (const id of needFetch) {
      if (!answered.has(id)) continue;
      cache.byAppId[String(id)] = urlsFromAssets(id, assets.get(id) ?? {});
      resolved += 1;
    }
    // Only stamp the new version once every id was re-resolved; otherwise the
    // unanswered ones would look fresh under the new version.
    if (resolved === needFetch.length) cache.version = CACHE_VERSION;
    if (resolved > 0) {
      cache.updatedAt = new Date().toISOString();
      await saveArtworkCache(cache);
    }
  }

  const result: Record<string, ArtworkUrls> = {};
  for (const id of unique) {
    result[String(id)] =
      cache.byAppId[String(id)] ?? legacyUrls(id);
  }
  return result;
}
