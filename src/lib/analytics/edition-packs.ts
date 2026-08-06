import type { ValuationGame } from "@/lib/analytics/valuation";

function norm(title: string) {
  return title
    .toLowerCase()
    .replace(/™|®/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Store packages / multi-game SKUs — not launchable for playtime. */
export function isBundleTitle(title: string): boolean {
  const n = norm(title);
  return /\bbundle\b/.test(n) || /\bpack\b/.test(n) || /\bcollection\b/.test(n);
}

/**
 * Strip common edition suffixes to find a possible base-game title.
 * e.g. "The Witcher 3: Wild Hunt - Complete Edition" → "the witcher 3: wild hunt"
 */
export function stripEditionSuffix(title: string): string | null {
  const n = norm(title);
  const patterns = [
    /\s*[-:–—]\s*complete edition$/,
    /\s+complete edition$/,
    /\s*[-:–—]\s*game of the year(?:\s+edition)?$/,
    /\s+game of the year(?:\s+edition)?$/,
    /\s*[-:–—]\s*goty(?:\s+edition)?$/,
    /\s+goty(?:\s+edition)?$/,
    /\s*[-:–—]\s*definitive edition$/,
    /\s+definitive edition$/,
    /\s*[-:–—]\s*ultimate edition$/,
    /\s+ultimate edition$/,
    /\s*[-:–—]\s*gold edition$/,
    /\s+gold edition$/,
    /\s*[-:–—]\s*deluxe edition$/,
    /\s+deluxe edition$/,
    /\s*[-:–—]\s*premium edition$/,
    /\s+premium edition$/,
  ];
  for (const re of patterns) {
    const next = n.replace(re, "").trim();
    if (next.length >= 4 && next !== n) return next;
  }
  return null;
}

function sumNullable(a: number | null, b: number | null): number | null {
  if (a == null && b == null) return null;
  return (a ?? 0) + (b ?? 0);
}

function mergeEditionIntoBase(
  base: ValuationGame,
  edition: ValuationGame,
): ValuationGame {
  const paid = sumNullable(base.paid, edition.paid);
  const current = sumNullable(base.current, edition.current);
  const lowest = sumNullable(base.lowest, edition.lowest);
  const kind =
    base.kind === "purchased" || edition.kind === "purchased"
      ? "purchased"
      : base.kind;

  return {
    ...base,
    title: base.title,
    steamAppId: base.steamAppId ?? edition.steamAppId,
    paid,
    current,
    lowest,
    onSale: base.onSale || edition.onSale,
    resolved: base.resolved || edition.resolved,
    kind,
    isGift: kind === "gifted_by_me",
    isUnpaidShelf: kind === "gifted_to_me" || kind === "free",
  };
}

function findBaseInList(
  edition: ValuationGame,
  games: ValuationGame[],
): ValuationGame | null {
  const baseKey = stripEditionSuffix(edition.title);
  if (!baseKey) return null;

  const exact = games.find(
    (g) => g !== edition && norm(g.title) === baseKey,
  );
  if (exact) return exact;

  // Soft: base key starts with another library title (trademark / punctuation drift)
  let best: ValuationGame | null = null;
  for (const g of games) {
    if (g === edition) continue;
    const t = norm(g.title);
    if (t.length < 4) continue;
    if (baseKey === t || baseKey.startsWith(`${t}:`) || baseKey.startsWith(`${t} `)) {
      if (!best || t.length > norm(best.title).length) best = g;
    }
  }
  return best;
}

/**
 * Fold Complete/GOTY/Ultimate edition SKUs into the base game when both
 * appear on the shelf (pack paid rolls into the playable title).
 * Does nothing when the edition *is* the only library entry (e.g. Horizon CE).
 */
export function foldEditionPacksIntoBase(
  games: ValuationGame[],
): ValuationGame[] {
  const remaining = [...games];
  let changed = true;
  let guard = 0;

  while (changed && guard < 8) {
    changed = false;
    guard += 1;
    for (let i = 0; i < remaining.length; i++) {
      const edition = remaining[i]!;
      if (isBundleTitle(edition.title)) continue;
      const base = findBaseInList(edition, remaining);
      if (!base) continue;
      // Prefer merging into the resolved / playable base row
      const baseIdx = remaining.indexOf(base);
      if (baseIdx < 0) continue;
      remaining[baseIdx] = mergeEditionIntoBase(base, edition);
      remaining.splice(i, 1);
      changed = true;
      break;
    }
  }

  return remaining;
}
