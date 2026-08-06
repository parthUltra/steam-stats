/**
 * Resolve Steam DLC → base-game app IDs (store appdetails fullgame).
 * Cached under data/ so dashboard builds stay cheap.
 */
import fs from "node:fs/promises";
import { mapPool, steamRateLimiter } from "@/lib/async/pool";
import { dataPath, ensureDataDir } from "@/lib/data/load-local";

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

async function loadCache(): Promise<DlcParentCache> {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(dataPath(CACHE_FILE), "utf8");
    return JSON.parse(raw) as DlcParentCache;
  } catch {
    return { updatedAt: "", parents: {}, notDlc: [] };
  }
}

async function saveCache(cache: DlcParentCache) {
  await ensureDataDir();
  await fs.writeFile(dataPath(CACHE_FILE), JSON.stringify(cache, null, 2));
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
      const res = await fetch(url, {
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

/**
 * Returns map of DLC appId → parent base-game appId.
 * Non-DLC apps are omitted.
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
    } else if (entry?.success) {
      delete cache.parents[key];
      notDlc.add(key);
    }
    // leave unknown on network failure so we retry next build

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

  const out = new Map<number, number>();
  for (const id of unique) {
    const parent = cache.parents[String(id)];
    if (parent != null && parent !== id) out.set(id, parent);
  }
  return out;
}

/**
 * Fallback when store lookup misses: title starts with another library
 * title + ":" / " - " (e.g. "Cyberpunk 2077: Phantom Liberty").
 */
export function inferParentByTitle(
  title: string,
  candidates: { title: string; steamAppId: number | null }[],
): number | null {
  const key = title
    .toLowerCase()
    .replace(/™|®/g, "")
    .replace(/\s+/g, " ")
    .trim();

  let best: { appId: number; len: number } | null = null;
  for (const c of candidates) {
    if (c.steamAppId == null) continue;
    const p = c.title
      .toLowerCase()
      .replace(/™|®/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (p.length < 4 || p === key) continue;
    if (
      key.startsWith(`${p}:`) ||
      key.startsWith(`${p} -`) ||
      key.startsWith(`${p} –`)
    ) {
      if (!best || p.length > best.len) {
        best = { appId: c.steamAppId, len: p.length };
      }
    }
  }
  return best?.appId ?? null;
}
