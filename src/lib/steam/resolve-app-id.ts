import { stripEditionSuffix } from "@/lib/analytics/edition-packs";

function norm(title: string) {
  return title
    .toLowerCase()
    .replace(/™|®/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extra SKU noise beyond Complete/GOTY-style edition packs. */
function stripSkuNoise(title: string): string {
  let n = norm(title);
  const patterns = [
    /\s*[-:–—]\s*the final cut$/,
    /\s+the final cut$/,
    /\s*[-:–—]\s*launch$/,
    /\s+launch$/,
    /\s*[-:–—]\s*gourmet edition$/,
    /\s+gourmet edition$/,
    /\s*\(row\)$/,
    /\s*\+.*$/, // "Game + DLC" bundles in the title
  ];
  for (const re of patterns) {
    const next = n.replace(re, "").trim();
    if (next.length >= 3) n = next;
  }
  const edition = stripEditionSuffix(n);
  return edition ?? n;
}

export type AppIdSource = {
  title: string;
  steamAppId: number | null;
};

/**
 * Resolve a purchase / valuation title to a playable Steam app ID.
 * Prefers longest / exact matches from playtime + priced library titles.
 */
export function resolveSteamAppId(
  title: string,
  sources: AppIdSource[],
): number | null {
  const key = norm(title);
  const stripped = stripSkuNoise(title);
  const usable = sources.filter((s) => s.steamAppId != null && s.steamAppId > 0);

  const exact = usable.find((s) => norm(s.title) === key);
  if (exact?.steamAppId) return exact.steamAppId;

  const exactStripped = usable.find((s) => norm(s.title) === stripped);
  if (exactStripped?.steamAppId) return exactStripped.steamAppId;

  // Title is an edition of a known game ("Disco Elysium - The Final Cut")
  let best: { id: number; len: number } | null = null;
  for (const s of usable) {
    const t = norm(s.title);
    if (t.length < 3) continue;
    if (
      key === t ||
      stripped === t ||
      key.startsWith(`${t}:`) ||
      key.startsWith(`${t} -`) ||
      key.startsWith(`${t} –`) ||
      key.startsWith(`${t} `) ||
      stripped.startsWith(`${t}:`) ||
      stripped.startsWith(`${t} -`) ||
      stripped.startsWith(`${t} `)
    ) {
      if (!best || t.length > best.len) {
        best = { id: s.steamAppId!, len: t.length };
      }
    }
  }
  if (best) return best.id;

  // Soft: known title contained in query (min length guard)
  for (const s of usable) {
    const t = norm(s.title);
    if (t.length < 8) continue;
    if (key.includes(t) || stripped.includes(t)) {
      if (!best || t.length > best.len) {
        best = { id: s.steamAppId!, len: t.length };
      }
    }
  }
  return best?.id ?? null;
}

export function sourcesFromPlaytime(
  games: { name: string; appId: number }[],
): AppIdSource[] {
  return games.map((g) => ({ title: g.name, steamAppId: g.appId }));
}

export function sourcesFromValuation(
  games: { title: string; steamAppId: number | null }[],
): AppIdSource[] {
  return games.map((g) => ({ title: g.title, steamAppId: g.steamAppId }));
}
