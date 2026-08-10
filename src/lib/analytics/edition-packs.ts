import type { ValuationGame } from "@/lib/analytics/valuation";
import {
  packCoversTitle,
  titlesSoftMatch,
} from "@/lib/analytics/acquisition";

function norm(title: string) {
  return title
    .toLowerCase()
    .replace(/™|®/g, "")
    .replace(/&copy;/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Store packages / multi-game SKUs — not a single playable game for shelf now. */
export function isBundleTitle(title: string): boolean {
  const n = norm(title);
  return (
    /\bbundle\b/.test(n) ||
    /\bthe collection\b/.test(n) ||
    /\bcollection\b/.test(n) ||
    /\bcomplete pack\b/.test(n) ||
    /\bmulti-?pack\b/.test(n)
  );
}

/**
 * True when this row is a multi-game pack that would double-count siblings
 * already on the shelf (BioShock/Arkham Collection, METAL SLUG Bundle).
 * Single-app “collections” with no covered siblings (e.g. Halo MCC) keep value.
 */
export function isRedundantPackSku(
  game: ValuationGame,
  shelf: ValuationGame[],
): boolean {
  if (!isBundleTitle(game.title)) return false;
  return shelf.some(
    (other) =>
      other !== game &&
      !isBundleTitle(other.title) &&
      packCoversTitle(game.title, other.title),
  );
}

/**
 * How “upgraded” a title is vs a bare base SKU.
 * Higher = prefer as the single shelf row (remaster over original, etc.).
 */
export function editionUpgradeRank(title: string): number {
  const n = norm(title);
  if (/\bremastered\b/.test(n) || /\bhd remaster\b/.test(n)) return 50;
  if (/\bdefinitive(?:\s+edition)?\b/.test(n)) return 40;
  if (/\benhanced(?:\s+edition)?\b/.test(n) || /\bdirector'?s cut\b/.test(n))
    return 35;
  if (/\bcomplete edition\b/.test(n)) return 30;
  if (/\bgame of the year\b/.test(n) || /\bgoty\b/.test(n)) return 25;
  if (/\bultimate(?:\s+edition)?\b/.test(n)) return 20;
  if (/\bdeluxe(?:\s+edition)?\b/.test(n) || /\bgold(?:\s+edition)?\b/.test(n))
    return 15;
  if (/\bpremium(?:\s+edition)?\b/.test(n)) return 12;
  // Store-only edition labels — prefer the cleaner playable title when both exist
  if (/\bstandard(?:\s+edition)?\b/.test(n)) return -10;
  if (/\blaunch(?:\s+edition)?\b/.test(n)) return -10;
  if (/\(row\)\b/.test(n)) return -5;
  return 0;
}

/**
 * Strip common edition / combo-SKU suffixes to find a possible base-game title.
 * e.g. "The Witcher 3: Wild Hunt - Complete Edition" → "the witcher 3: wild hunt"
 * e.g. "Devil May Cry 5 + Vergil" → "devil may cry 5"
 * e.g. "BioShock Remastered" → "bioshock"
 * e.g. "DOOM Eternal Standard Edition" → "doom eternal"
 */
export function stripEditionSuffix(title: string): string | null {
  const n = norm(title);
  const patterns = [
    /\s*\+.*$/, // "Game + DLC" / "Game + Character" store combos
    /\s*\(row\)\s*$/,
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
    /\s*[-:–—]\s*standard edition$/,
    /\s+standard edition$/,
    /\s*[-:–—]\s*launch(?:\s+edition)?$/,
    /\s+launch(?:\s+edition)?$/,
    /\s*[-:–—]\s*enhanced edition$/,
    /\s+enhanced edition$/,
    /\s*[-:–—]\s*director'?s cut$/,
    /\s+director'?s cut$/,
    /\s*[-:–—]\s*hd remaster$/,
    /\s+hd remaster$/,
    /\s*[-:–—]\s*remastered$/,
    /\s+remastered$/,
    /\s*[-:–—]\s*vr(?:\s+edition)?$/,
    /\s+vr(?:\s+edition)?$/,
    /\s*[-:–—]\s*game of the yorha(?:\s+edition)?$/,
    /\s+game of the yorha(?:\s+edition)?$/,
  ];
  for (const re of patterns) {
    const next = n.replace(re, "").trim();
    if (next.length >= 4 && next !== n) return next;
  }
  return null;
}

function maxNullable(a: number | null, b: number | null): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return Math.max(a, b);
}

function rowScore(g: ValuationGame): number {
  return (
    editionUpgradeRank(g.title) * 100 +
    (g.current != null && g.current > 0 ? 20 : 0) +
    (g.resolved ? 5 : 0) +
    (g.steamAppId != null ? 2 : 0) +
    (g.paid != null && g.paid > 0 ? 1 : 0)
  );
}

/** Prefer remaster / playable SKU over original or store-only “Standard Edition”. */
function preferShelfRow(a: ValuationGame, b: ValuationGame): ValuationGame {
  return rowScore(a) >= rowScore(b) ? a : b;
}

function mergeEditionIntoBase(
  base: ValuationGame,
  edition: ValuationGame,
): ValuationGame {
  // Edition / remaster / standard SKUs are the same effective game — never sum
  // live prices. Paid is max so one wallet line isn’t double-counted.
  const paid = maxNullable(base.paid, edition.paid);
  // Shelf now / lowest: one effective market price (remaster when both owned)
  const survivor = preferShelfRow(base, edition);
  const other = survivor === base ? edition : base;
  const current =
    survivor.current != null && survivor.current > 0
      ? survivor.current
      : other.current != null && other.current > 0
        ? other.current
        : maxNullable(base.current, edition.current);
  const lowest =
    survivor.kind === "free" || other.kind === "free"
      ? survivor.kind === "free"
        ? 0
        : other.kind === "free"
          ? 0
          : maxNullable(base.lowest, edition.lowest)
      : survivor.lowest != null && survivor.lowest > 0
        ? survivor.lowest
        : other.lowest != null && other.lowest > 0
          ? other.lowest
          : maxNullable(base.lowest, edition.lowest);

  const kind =
    base.kind === "purchased" ||
    edition.kind === "purchased" ||
    base.kind === "bundle" ||
    edition.kind === "bundle"
      ? base.kind === "bundle" || edition.kind === "bundle"
        ? paid != null && paid > 0
          ? "purchased"
          : "bundle"
        : "purchased"
      : rowScore(base) >= rowScore(edition)
        ? base.kind
        : edition.kind;

  return {
    ...survivor,
    title: survivor.title,
    steamAppId: survivor.steamAppId ?? other.steamAppId,
    paid,
    current,
    lowest,
    onSale: base.onSale || edition.onSale,
    resolved: base.resolved || edition.resolved,
    kind,
    isGift: kind === "gifted_by_me",
    isUnpaidShelf:
      kind === "gifted_to_me" ||
      kind === "free" ||
      kind === "ownership_grant" ||
      kind === "unknown_unpaid",
    acquisitionNote:
      survivor.acquisitionNote ??
      other.acquisitionNote ??
      (editionUpgradeRank(survivor.title) >
      editionUpgradeRank(other.title)
        ? "Remaster / edition folded (original not double-counted)"
        : undefined),
    giftedFrom: survivor.giftedFrom ?? other.giftedFrom,
    giftedTo: survivor.giftedTo ?? other.giftedTo,
  };
}

function findBaseInList(
  edition: ValuationGame,
  games: ValuationGame[],
): ValuationGame | null {
  const baseKey = stripEditionSuffix(edition.title);

  if (baseKey) {
    const exact = games.find(
      (g) => g !== edition && norm(g.title) === baseKey,
    );
    if (exact) return exact;

    // Soft: base key matches another library title (trademark / punctuation drift)
    let best: ValuationGame | null = null;
    for (const g of games) {
      if (g === edition) continue;
      const t = norm(g.title);
      if (t.length < 4) continue;
      if (
        baseKey === t ||
        baseKey.startsWith(`${t}:`) ||
        baseKey.startsWith(`${t} `) ||
        t.startsWith(`${baseKey} `) ||
        t.startsWith(`${baseKey}:`)
      ) {
        // Don't treat sequels as the same game ("bioshock 2" vs "bioshock")
        const restFromBase = t.startsWith(baseKey)
          ? t.slice(baseKey.length).trim()
          : "";
        const restFromT = baseKey.startsWith(t)
          ? baseKey.slice(t.length).trim()
          : "";
        const sequelRest = (r: string) =>
          /^(i{1,3}|iv|vi{0,3}|ix|\d+)\b/i.test(r.replace(/^[\s:–—-]+/, ""));
        if (sequelRest(restFromBase) || sequelRest(restFromT)) continue;

        if (!best || t.length > norm(best.title).length) best = g;
      }
    }
    if (best) return best;
  }

  // Broader soft match: "NieR YoRHa Edition" ↔ "NieR:Automata", etc.
  let softBest: ValuationGame | null = null;
  let softScore = -Infinity;
  for (const g of games) {
    if (g === edition) continue;
    if (isBundleTitle(g.title)) continue;
    if (!titlesSoftMatch(edition.title, g.title)) continue;
    // Must be an edition relationship, not two unrelated soft hits
    const a = stripEditionSuffix(edition.title) || norm(edition.title);
    const b = stripEditionSuffix(g.title) || norm(g.title);
    if (a === b || titlesSoftMatch(a, b) || titlesSoftMatch(edition.title, g.title)) {
      const score = rowScore(g);
      if (!softBest || score > softScore) {
        softBest = g;
        softScore = score;
      }
    }
  }
  return softBest;
}

/**
 * Fold Complete/GOTY/Ultimate/Remastered/"Game + DLC"/Standard Edition SKUs
 * into one shelf row when both variants are owned. Prefers remaster over
 * original; never sums live prices across editions.
 */
export function foldEditionPacksIntoBase(
  games: ValuationGame[],
): ValuationGame[] {
  const remaining = [...games];
  let changed = true;
  let guard = 0;

  while (changed && guard < 12) {
    changed = false;
    guard += 1;
    for (let i = 0; i < remaining.length; i++) {
      const edition = remaining[i]!;
      if (isBundleTitle(edition.title)) continue;
      const base = findBaseInList(edition, remaining);
      if (!base) continue;
      if (isBundleTitle(base.title)) continue;
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

/**
 * Multi-game packs that already have their games on the shelf must not add
 * market value. Single-app collections with no covered siblings keep prices.
 */
export function clearBundleShelfPrices(
  games: ValuationGame[],
): ValuationGame[] {
  return games.map((g) => {
    if (!isRedundantPackSku(g, games)) return g;
    return {
      ...g,
      current: null,
      lowest: g.kind === "free" ? 0 : null,
      onSale: false,
    };
  });
}
