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

function loose(title: string): string {
  return norm(title)
    .replace(/[-–—:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when `full` is the same title or an extended edition of `short`. */
function isTitleExtension(shortKey: string, fullTitle: string): boolean {
  const full = norm(fullTitle);
  const short = norm(shortKey);
  if (full.length < short.length || short.length < 3) return false;
  if (full === short) return true;
  return (
    full.startsWith(`${short}:`) ||
    full.startsWith(`${short} -`) ||
    full.startsWith(`${short} –`) ||
    full.startsWith(`${short} —`) ||
    full.startsWith(`${short} `)
  );
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
  const looseKey = loose(title);
  const usable = sources.filter((s) => s.steamAppId != null && s.steamAppId > 0);

  const exact = usable.find((s) => norm(s.title) === key);
  if (exact?.steamAppId) return exact.steamAppId;

  const exactStripped = usable.find((s) => norm(s.title) === stripped);
  if (exactStripped?.steamAppId) return exactStripped.steamAppId;

  const exactLoose = usable.find(
    (s) => loose(s.title) === looseKey || loose(stripSkuNoise(s.title)) === looseKey,
  );
  if (exactLoose?.steamAppId) return exactLoose.steamAppId;

  // Bidirectional edition / short-name match:
  // "The Witcher 2" ↔ "The Witcher 2: Assassins of Kings Enhanced Edition"
  let best: { id: number; len: number } | null = null;
  for (const s of usable) {
    const t = norm(s.title);
    const sStripped = stripSkuNoise(s.title);
    if (t.length < 3) continue;
    if (
      isTitleExtension(key, s.title) ||
      isTitleExtension(stripped, s.title) ||
      isTitleExtension(t, title) ||
      isTitleExtension(sStripped, title) ||
      isTitleExtension(key, sStripped) ||
      isTitleExtension(stripped, sStripped)
    ) {
      if (!best || t.length > best.len) {
        best = { id: s.steamAppId!, len: t.length };
      }
    }
  }
  if (best) return best.id;

  // Soft: longer known title contains the query (min length guard)
  for (const s of usable) {
    const t = norm(s.title);
    if (key.length < 8 || t.length < key.length) continue;
    if (t.includes(key) || loose(s.title).includes(looseKey)) {
      if (!best || t.length > best.len) {
        best = { id: s.steamAppId!, len: t.length };
      }
    }
  }
  return best?.id ?? null;
}

function collectionStem(title: string): string {
  return loose(title)
    .replace(
      /\b(collection|bundle|complete pack|season pass|game of the year(?: edition)?|goty(?: edition)?)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * App ID for artwork. Collection / package SKUs often aren't real apps
 * (e.g. Batman: Arkham Collection → sub 320795 with no /apps/ capsule).
 * Prefer a playable series title you own when the purchase is a pack.
 */
export function resolveArtworkAppId(
  title: string,
  sources: AppIdSource[],
): number | null {
  const primary = resolveSteamAppId(title, sources);
  const key = norm(title);
  const isPack = /\b(collection|bundle|complete pack|multi-?pack|\d+\s*-?\s*packs?)\b/.test(
    key,
  );

  if (!isPack) return primary;

  const stem = collectionStem(title);
  const stemWords = stem.split(" ").filter((w) => w.length > 2);
  if (stemWords.length < 1) return primary;

  const usable = sources.filter((s) => s.steamAppId != null && s.steamAppId > 0);
  let best: { id: number; score: number } | null = null;

  for (const s of usable) {
    if (s.steamAppId === primary && isPack) {
      // Skip the pack row itself when looking for a playable cover
      if (norm(s.title) === key) continue;
    }
    const t = loose(s.title);
    if (/\b(collection|bundle|season pass)\b/.test(t)) continue;

    const wordsHit = stemWords.filter((w) => t.includes(w)).length;
    if (wordsHit < Math.min(2, stemWords.length)) continue;
    // Prefer titles that contain the stem as a phrase, then longer names
    const phraseBonus = t.includes(stem) ? 1000 : 0;
    // Prefer later / flagship entries when several series games match
    const seriesBonus = /\bknight\b/.test(t)
      ? 120
      : /\bcity\b/.test(t)
        ? 60
        : 0;
    const score = phraseBonus + seriesBonus + wordsHit * 50 + t.length;
    if (!best || score > best.score) {
      best = { id: s.steamAppId!, score };
    }
  }

  return best?.id ?? primary;
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
