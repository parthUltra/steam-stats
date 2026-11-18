/**
 * Resolve Steam DLC → base-game app IDs (store appdetails fullgame).
 * Cached under data/ so dashboard builds stay cheap.
 */
import { mapPool, steamRateLimiter } from "@/lib/async/pool";
import { readJsonFile, updateJsonFile } from "@/lib/data/json-store";
import { dataPath, ensureDataDir } from "@/lib/data/load-local";
import { isOffline, netFetch } from "@/lib/runtime";

export type DlcParentCache = {
  updatedAt: string;
  /** dlcAppId → parentAppId */
  parents: Record<string, number>;
  /** appIds confirmed not DLC (or unresolved) */
  notDlc: string[];
};

const CACHE_FILE = "dlc-parents.json";
const UA = "steam-stats-local/0.1 (personal; localhost)";
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const DLC_CONCURRENCY = 4;
const CHECKPOINT_EVERY = 20;

/** Missing file → empty cache; unreadable / corrupt file → throws. */
async function loadCache(): Promise<DlcParentCache> {
  const parsed = await readJsonFile<DlcParentCache>(dataPath(CACHE_FILE));
  return {
    updatedAt: parsed?.updatedAt ?? "",
    parents: parsed?.parents ?? {},
    notDlc: Array.isArray(parsed?.notDlc) ? parsed.notDlc : [],
  };
}

/**
 * Keep answers another process stored since we loaded. Our own verdict for an
 * app wins: a disk "parent" is not resurrected for an app we just found is
 * not DLC, and vice versa.
 */
function mergeDlcCaches(mine: DlcParentCache, disk: DlcParentCache): DlcParentCache {
  const notDlc = new Set(mine.notDlc);
  for (const [id, parent] of Object.entries(disk.parents ?? {})) {
    if (mine.parents[id] == null && !notDlc.has(id)) mine.parents[id] = parent;
  }
  for (const id of disk.notDlc ?? []) {
    if (mine.parents[id] == null) notDlc.add(id);
  }
  mine.notDlc = [...notDlc];
  return mine;
}

/** Atomic, locked, merged with what is on disk. Throws if the file is corrupt. */
async function saveCache(cache: DlcParentCache) {
  await ensureDataDir();
  await updateJsonFile<DlcParentCache>(dataPath(CACHE_FILE), (disk) =>
    disk ? mergeDlcCaches(cache, disk) : cache,
  );
}

type AppDetailsEntry = {
  success?: boolean;
  data?: {
    type?: string;
    fullgame?: { appid?: string | number; name?: string };
  };
};

async function fetchOne(appId: number): Promise<AppDetailsEntry | null> {
  const url = `https://store.steampowered.com/api/appdetails?appids=${appId}&filters=basic`;
  return steamRateLimiter.schedule(async () => {
    try {
      const res = await netFetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        cache: "no-store",
      });
      if (!res.ok) return null;
      const data = (await res.json()) as Record<string, AppDetailsEntry> | null;
      if (!data || typeof data !== "object") return null;
      return data[String(appId)] ?? null;
    } catch {
      return null;
    }
  });
}

function parentsFor(
  cache: DlcParentCache,
  appIds: number[],
): Map<number, number> {
  const out = new Map<number, number>();
  for (const id of appIds) {
    const parent = cache.parents[String(id)];
    if (parent != null && parent !== id) out.set(id, parent);
  }
  return out;
}

/**
 * Cache read only — no network, no write. This is what the request path uses;
 * `resolveDlcParents` (network + write) runs from scripts/refresh-prices.ts.
 */
export async function readDlcParents(
  appIds: number[],
): Promise<Map<number, number>> {
  try {
    return parentsFor(await loadCache(), appIds);
  } catch (err) {
    // Regenerable cache on the request path: degrade to "no DLC folding"
    // rather than fail the dashboard. The write path stays strict.
    console.warn(err instanceof Error ? err.message : err);
    return new Map();
  }
}

/**
 * Returns map of DLC appId → parent base-game appId.
 * Non-DLC apps are omitted. Hits the Steam store and writes the cache.
 */
export async function resolveDlcParents(
  appIds: number[],
  opts?: { force?: boolean },
): Promise<Map<number, number>> {
  const unique = [...new Set(appIds.filter((id) => Number.isFinite(id) && id > 0))];
  const cache = await loadCache();
  const notDlc = new Set(cache.notDlc);
  const stale =
    !cache.updatedAt ||
    Date.now() - Date.parse(cache.updatedAt) > MAX_AGE_MS;

  const need: number[] = [];
  for (const id of unique) {
    const key = String(id);
    if (!opts?.force) {
      if (cache.parents[key] != null) continue;
      if (notDlc.has(key) && !stale) continue;
    }
    need.push(id);
  }

  // Offline (or nothing to resolve): answer from the cache, write nothing.
  if (isOffline() || need.length === 0) return parentsFor(cache, unique);

  let completed = 0;
  await mapPool(need, DLC_CONCURRENCY, async (id) => {
    const key = String(id);
    const entry = await fetchOne(id);
    const type = entry?.data?.type?.toLowerCase();
    const parentRaw = entry?.data?.fullgame?.appid;
    const parent =
      parentRaw != null && String(parentRaw).trim() !== ""
        ? Number(parentRaw)
        : NaN;

    if (entry?.success && type === "dlc" && Number.isFinite(parent) && parent > 0) {
      cache.parents[key] = parent;
      notDlc.delete(key);
    } else if (entry != null && typeof entry.success === "boolean") {
      // `success: true` and not DLC, or `success: false` (delisted / region
      // locked / not an app). Both are definitive answers from the store, so
      // negative-cache them; they are re-checked once the cache goes stale.
      delete cache.parents[key];
      notDlc.add(key);
    }
    // entry == null → network / HTTP failure: leave unknown and retry next run

    completed += 1;
    if (completed % CHECKPOINT_EVERY === 0) {
      cache.notDlc = [...notDlc];
      cache.updatedAt = new Date().toISOString();
      await saveCache(cache);
    }
  });

  cache.notDlc = [...notDlc];
  cache.updatedAt = new Date().toISOString();
  await saveCache(cache);

  return parentsFor(cache, unique);
}
