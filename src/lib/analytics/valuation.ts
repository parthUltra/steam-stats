import type { LicenseRow, PurchaseHistoryRow } from "@/lib/account-data";
import {
  classifyAcquisition,
  normTitle,
  titlesSoftMatch,
  type AcquisitionKind,
} from "@/lib/analytics/acquisition";
import {
  isGiftPurchase,
  isTrackableGamePurchase,
  libraryTitlesForValuation,
  moneyOf,
  type SpendingAnalytics,
} from "@/lib/analytics/spending";
import { foldEditionPacksIntoBase, clearBundleShelfPrices, isRedundantPackSku } from "@/lib/analytics/edition-packs";
import type { GamePriceQuote, PriceCache } from "@/lib/pricing/prices";

export type { AcquisitionKind } from "@/lib/analytics/acquisition";

export type ValuationGame = {
  title: string;
  paid: number | null;
  current: number | null;
  lowest: number | null;
  steamAppId: number | null;
  onSale: boolean;
  resolved: boolean;
  kind: AcquisitionKind;
  /** @deprecated use kind === "gifted_by_me" */
  isGift: boolean;
  /** Unpaid shelf: gift / free / ownership grant / unclear unpaid */
  isUnpaidShelf: boolean;
  /** Short provenance when known (bundle name, license note, …) */
  acquisitionNote?: string;
  /** Steam persona who gifted this to you */
  giftedFrom?: string;
  /** Steam persona you gifted this to */
  giftedTo?: string;
};

export type ValueSlice = {
  spent: number;
  current: number;
  lowest: number;
  titlesResolved: number;
  titlesConsidered: number;
};

export type LibraryValuation = {
  currency: string;
  usdToDisplayRate: number | null;
  /**
   * What you paid for your library (never includes gifts you sent,
   * never includes free / gifted-to-you as spend).
   */
  librarySpent: number;
  /** Full kept shelf now/lowest — paid + free + gifted-to-you */
  shelfFull: ValueSlice;
  /** Paid purchases only now/lowest */
  shelfPaidOnly: ValueSlice;
  /** Full shelf excluding mail-imported gifts received */
  shelfExcludingReceivedGifts: ValueSlice;
  /** Free + gifted-to-you contribution to shelf */
  unpaidShelf: ValueSlice;
  /** Money you spent buying gifts for others (not in library) */
  giftsSent: ValueSlice;
  /** Shelf value of games gifted to you (Gift/Guest Pass only) */
  giftsReceived: ValueSlice;
  games: ValuationGame[];
  giftsSentGames: ValuationGame[];
  /** Confirmed Gift/Guest Pass licenses only */
  giftsReceivedGames: ValuationGame[];
  /** Free / complimentary / F2P */
  freeGames: ValuationGame[];
  /** Included via a paid collection / bundle checkout */
  bundleGames: ValuationGame[];
  /** Remaster / upgrade likely granted for owning a base */
  ownershipGrantGames: ValuationGame[];
  /** Owned unpaid — origin unclear (not labeled as gifts) */
  unknownUnpaidGames: ValuationGame[];
  unresolvedTitles: string[];
  note: string;
  valveTotalSpend: number | null;
  valvePackageSpend: number | null;
  valvePackageSavings: number | null;
  // Back-compat aliases (UI / older callers)
  excludingGifts: ValueSlice;
  includingGifts: ValueSlice;
  giftOnly: ValueSlice;
  deltaCurrentVsLowestExcl: number;
  deltaCurrentVsLowestIncl: number;
  paidVsCurrentExcl: number | null;
  paidVsCurrentIncl: number | null;
  currentValue: number;
  lowestValue: number;
  titlesConsidered: number;
  titlesResolved: number;
  titlesWithLocalPrice: number;
  paidVsCurrent: number | null;
  deltaCurrentVsLowest: number;
};

function norm(title: string) {
  return normTitle(title);
}

function isUnpaidKind(kind: AcquisitionKind) {
  return (
    kind === "gifted_to_me" ||
    kind === "free" ||
    kind === "ownership_grant" ||
    kind === "unknown_unpaid"
  );
}

function sortByShelfValue(games: ValuationGame[]) {
  return [...games].sort(
    (a, b) =>
      (effectiveShelfNow(b) ?? 0) - (effectiveShelfNow(a) ?? 0) ||
      a.title.localeCompare(b.title),
  );
}

function isGiftCardName(name: string) {
  return /gift card/i.test(name);
}

/** Cost basis for games you bought for yourself (not gifts). */
export function paidByTitle(
  purchases: PurchaseHistoryRow[],
  opts?: { giftsOnly?: boolean },
): Map<string, number> {
  const giftsOnly = Boolean(opts?.giftsOnly);
  const map = new Map<string, number>();

  // Library rows are newest-first; walk oldest→newest so the first kept copy
  // owns cost basis. Multi-copy checkouts (4× PEAK) must not stack onto shelf.
  const rows = giftsOnly ? purchases : [...purchases].reverse();

  for (const row of rows) {
    const gift = isGiftPurchase(row);
    if (giftsOnly) {
      if (!gift || row.refunded) continue;
    } else if (!isTrackableGamePurchase(row)) {
      continue;
    }

    if (row.lineItems?.length) {
      const amountsByKey = new Map<string, number[]>();
      for (const line of row.lineItems) {
        if (line.amount == null || line.amount < 0) continue;
        if (isGiftCardName(line.name)) continue;
        const key = norm(line.name);
        const list = amountsByKey.get(key) ?? [];
        list.push(line.amount);
        amountsByKey.set(key, list);
      }
      for (const [key, amounts] of amountsByKey) {
        const total = amounts.reduce((a, b) => a + b, 0);
        if (giftsOnly) {
          map.set(key, (map.get(key) ?? 0) + total);
          continue;
        }
        // One shelf copy → one unit; extra copies in the same txn are ignored
        const unit = total / amounts.length;
        if (!map.has(key)) map.set(key, unit);
      }
      continue;
    }

    const amount = moneyOf(row);
    if (amount <= 0 || row.items.length === 0) continue;
    const usable = row.items.filter((i) => !isGiftCardName(i));
    if (!usable.length) continue;

    const copiesByKey = new Map<string, number>();
    for (const item of usable) {
      const key = norm(item);
      copiesByKey.set(key, (copiesByKey.get(key) ?? 0) + 1);
    }
    const share = amount / usable.length;
    for (const [key, copies] of copiesByKey) {
      if (giftsOnly) {
        map.set(key, (map.get(key) ?? 0) + share * copies);
        continue;
      }
      // Each item slot is one unit share; only keep a single copy for shelf.
      if (!map.has(key)) map.set(key, share);
    }
  }
  return map;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function inferUsdToDisplayRate(priceCache: PriceCache): number | null {
  const ratios: number[] = [];
  for (const q of Object.values(priceCache.quotes)) {
    // Prefer retail local/USD when both exist — sale prices skew the FX ratio
    if (
      q.retailInr != null &&
      q.retailInr > 0 &&
      q.retailUsd != null &&
      q.retailUsd > 0
    ) {
      const r = q.retailInr / q.retailUsd;
      if (r > 0.05 && r < 500) ratios.push(r);
      continue;
    }
    if (
      q.currentUsd != null &&
      q.currentUsd > 0 &&
      q.currentInr != null &&
      q.currentInr > 0
    ) {
      const r = q.currentInr / q.currentUsd;
      if (r > 0.05 && r < 500) ratios.push(r);
    }
  }
  return median(ratios);
}

function quoteCurrentInCurrency(
  quote: GamePriceQuote,
  currency: string,
  usdRate: number | null,
  storeCurrency: string,
): number | null {
  let raw: number | null = null;
  const storeCur = storeCurrency.toUpperCase();
  const displayCur = currency.toUpperCase();

  if (displayCur === storeCur) {
    if (quote.currentInr != null) raw = quote.currentInr;
    else if (quote.currentUsd != null && usdRate != null) {
      raw = quote.currentUsd * usdRate;
    }
  } else if (displayCur === "USD") {
    raw = quote.currentUsd;
  } else if (quote.currentUsd != null && usdRate != null) {
    raw = quote.currentUsd * usdRate;
  } else {
    raw = quote.currentUsd;
  }
  // 0 / missing store price → treat as unlisted (show "—", fall back to low)
  if (raw == null || raw <= 0) return null;
  return raw;
}

function quoteLowestInCurrency(
  quote: GamePriceQuote,
  currency: string,
  currentLocal: number | null,
  _usdRate: number | null,
  storeCurrency: string,
): number | null {
  // Only IsThereAnyDeal Steam store all-time low — never CheapShark / FX invent.
  if (quote.lowestInr == null || quote.lowestInr <= 0) return null;

  const storeCur = storeCurrency.toUpperCase();
  const displayCur = currency.toUpperCase();

  const currentStore =
    quote.currentInr != null && quote.currentInr > 0
      ? quote.currentInr
      : displayCur === storeCur
        ? currentLocal
        : null;

  // Cap at live store price when we have it
  if (currentStore != null && quote.lowestInr > currentStore) {
    if (displayCur === storeCur) return currentStore;
    if (currentLocal != null && currentStore > 0) {
      return currentLocal * (quote.lowestInr / currentStore);
    }
    return null;
  }

  if (displayCur === storeCur) return quote.lowestInr;

  // Non-matching display: scale from store via live quote when possible
  if (
    currentLocal != null &&
    currentStore != null &&
    currentStore > 0
  ) {
    return currentLocal * (quote.lowestInr / currentStore);
  }
  return null;
}

/** Shelf “now” for totals: live price, else historical low when unlisted. */
export function effectiveShelfNow(game: {
  current: number | null;
  lowest: number | null;
}): number | null {
  if (game.current != null && game.current > 0) return game.current;
  if (game.lowest != null && game.lowest > 0) return game.lowest;
  return null;
}

/**
 * Stored hist-low for shelf “lowest” totals (ITAD Steam for detected country).
 * Free titles are 0. No fallback to live price — missing lows stay out
 * of the total until they’re stored (UI may hybridize while calibrating).
 */
export function effectiveShelfLowest(game: {
  current: number | null;
  lowest: number | null;
  kind?: string;
}): number | null {
  if (game.kind === "free") return 0;
  if (game.lowest != null && game.lowest > 0) return game.lowest;
  return null;
}

/** While lows are still filling: hist low if known, else live shelf price. */
export function effectiveShelfLowestBestKnown(game: {
  current: number | null;
  lowest: number | null;
  kind?: string;
}): number | null {
  if (game.kind === "free") return 0;
  if (game.lowest != null && game.lowest > 0) return game.lowest;
  if (game.current != null && game.current > 0) return game.current;
  return null;
}

function findQuote(
  priceCache: PriceCache,
  title: string,
): GamePriceQuote | undefined {
  const key = norm(title);
  const exact = priceCache.quotes[key];
  if (exact?.steamAppId != null && exact.source !== "unresolved") {
    return exact;
  }

  // Punctuation-tolerant match ("Unrailed" ↔ "Unrailed!", "Brotato - DLC" ↔ "Brotato: DLC")
  // without grabbing a shorter base-game quote via substring includes.
  const loose = (t: string) =>
    norm(t)
      .replace(/[-–—:!?.]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const looseKey = loose(title);
  if (looseKey.length >= 2) {
    for (const [k, q] of Object.entries(priceCache.quotes)) {
      if (q.steamAppId == null || q.source === "unresolved") continue;
      if (loose(k) === looseKey || loose(q.title) === looseKey) return q;
    }
  }

  // Keep an exact unresolved row so the title stays visible for gift/DLC fold
  return exact;
}

function giftSentTitles(purchases: PurchaseHistoryRow[]): string[] {
  const titles = new Set<string>();
  for (const row of purchases) {
    if (!isGiftPurchase(row) || row.refunded) continue;
    const names = row.lineItems?.map((l) => l.name) ?? row.items ?? [];
    for (const name of names) {
      if (!name || isGiftCardName(name)) continue;
      if (/^gift sent to\b/i.test(name)) continue;
      titles.add(name);
    }
  }
  return [...titles];
}

/** Norm title → Steam persona you gifted to (last wins if duplicates). */
function giftSentRecipients(
  purchases: PurchaseHistoryRow[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of purchases) {
    if (!isGiftPurchase(row) || row.refunded) continue;
    const to = row.giftRecipient?.trim();
    if (!to) continue;
    const names = row.lineItems?.map((l) => l.name) ?? row.items ?? [];
    for (const name of names) {
      if (!name || isGiftCardName(name) || /^gift sent to\b/i.test(name)) {
        continue;
      }
      map.set(norm(name), to);
    }
  }
  return map;
}

function sumShelf(
  games: ValuationGame[],
  pred: (g: ValuationGame) => boolean,
): ValueSlice {
  let spent = 0;
  let current = 0;
  let lowest = 0;
  let titlesResolved = 0;
  let titlesConsidered = 0;

  for (const g of games) {
    if (!pred(g)) continue;
    // Multi-game collection/bundle SKUs that already cover sibling games
    if (isRedundantPackSku(g, games)) {
      titlesConsidered += 1;
      if (g.paid != null) spent += g.paid;
      continue;
    }
    titlesConsidered += 1;
    if (g.paid != null) spent += g.paid;
    if (!g.resolved) continue;
    titlesResolved += 1;
    const now = effectiveShelfNow(g);
    if (now != null) current += now;
    const low = effectiveShelfLowest(g);
    if (low != null) lowest += low;
  }

  return { spent, current, lowest, titlesResolved, titlesConsidered };
}

/**
 * Remasters sometimes lack an ITAD Steam store-low while the original SKU has
 * one (BioShock Remastered vs BioShock). Use the best related store low.
 */
function relatedEditionIndiaLow(
  priceCache: PriceCache,
  title: string,
  selfKey: string,
): number | null {
  let best: number | null = null;
  for (const [k, q] of Object.entries(priceCache.quotes)) {
    if (k === selfKey) continue;
    if (q.lowestInr == null || q.lowestInr <= 0) continue;
    if (!titlesSoftMatch(title, q.title) && !titlesSoftMatch(title, k)) {
      continue;
    }
    best = best == null ? q.lowestInr : Math.min(best, q.lowestInr);
  }
  return best;
}

function priceGame(
  title: string,
  paid: number | null,
  kind: AcquisitionKind,
  priceCache: PriceCache,
  currency: string,
  usdRate: number | null,
  storeCurrency: string,
  unresolvedTitles: string[],
  acquisitionNote?: string,
  giftPeople?: { giftedFrom?: string; giftedTo?: string },
): ValuationGame {
  const quote = findQuote(priceCache, title);
  const isGift = kind === "gifted_by_me";
  const isUnpaidShelf = isUnpaidKind(kind);
  const giftedFrom = giftPeople?.giftedFrom;
  const giftedTo = giftPeople?.giftedTo;

  if (!quote || quote.source === "unresolved" || quote.steamAppId == null) {
    unresolvedTitles.push(quote?.title ?? title);
    return {
      title: quote?.title ?? title,
      paid,
      current: null,
      lowest: kind === "free" ? 0 : null,
      steamAppId: null,
      onSale: false,
      resolved: kind === "free",
      kind,
      isGift,
      isUnpaidShelf,
      acquisitionNote,
      giftedFrom,
      giftedTo,
    };
  }

  const current = quoteCurrentInCurrency(quote, currency, usdRate, storeCurrency);
  // Free-to-keep titles: lowest is ₹0 (not market/live price)
  if (kind === "free") {
    return {
      title: quote.title || title,
      paid,
      current,
      lowest: 0,
      steamAppId: quote.steamAppId,
      onSale: quote.onSale,
      resolved: true,
      kind,
      isGift,
      isUnpaidShelf,
      acquisitionNote,
      giftedFrom,
      giftedTo,
    };
  }

  let lowest = quoteLowestInCurrency(quote, currency, current, usdRate, storeCurrency);
  if (lowest == null) {
    const related = relatedEditionIndiaLow(
      priceCache,
      quote.title || title,
      normalizeQuoteKey(quote.title || title),
    );
    if (related != null) {
      lowest =
        currency.toUpperCase() === storeCurrency.toUpperCase()
          ? related
          : current != null &&
              quote.currentInr != null &&
              quote.currentInr > 0
            ? current * (related / quote.currentInr)
            : null;
    }
  }
  if (lowest != null && lowest <= 0) lowest = null;

  // Cap at live price — hist low cannot exceed shelf now
  if (lowest != null && current != null && lowest > current) {
    lowest = current;
  }

  return {
    title: quote.title || title,
    paid,
    current,
    lowest,
    steamAppId: quote.steamAppId,
    onSale: quote.onSale,
    resolved: true,
    kind,
    isGift,
    isUnpaidShelf,
    acquisitionNote,
    giftedFrom,
    giftedTo,
  };
}

function normalizeQuoteKey(title: string) {
  return norm(title);
}

function acquisitionPriority(kind: AcquisitionKind): number {
  if (kind === "purchased" || kind === "bundle") return 4;
  if (kind === "gifted_to_me") return 3;
  if (kind === "ownership_grant") return 2;
  if (kind === "free") return 1;
  if (kind === "unknown_unpaid") return 1;
  return 0;
}

/** Collapse DLC / quote-title collisions onto one shelf row per app. */
function dedupeLibraryGames(games: ValuationGame[]): ValuationGame[] {
  const byApp = new Map<number, ValuationGame>();
  const unresolved: ValuationGame[] = [];
  const unresolvedSeen = new Set<string>();

  const mergeRows = (keep: ValuationGame, drop: ValuationGame): ValuationGame => {
    const preferTitle =
      /[!?]$/.test(keep.title) || keep.title.length >= drop.title.length
        ? keep.title
        : /[!?]$/.test(drop.title) || drop.title.length > keep.title.length
          ? drop.title
          : keep.title;
    return {
      ...keep,
      title: preferTitle,
      paid:
        keep.kind === "purchased" || drop.kind === "purchased"
          ? Math.max(keep.paid ?? 0, drop.paid ?? 0) || keep.paid || drop.paid
          : keep.paid ?? drop.paid,
      current:
        keep.current != null && keep.current > 0
          ? keep.current
          : drop.current != null && drop.current > 0
            ? drop.current
            : keep.current ?? drop.current,
      lowest:
        keep.lowest != null && keep.lowest > 0
          ? keep.lowest
          : drop.lowest != null && drop.lowest > 0
            ? drop.lowest
            : keep.lowest ?? drop.lowest,
      steamAppId: keep.steamAppId ?? drop.steamAppId,
      onSale: keep.onSale || drop.onSale,
      resolved: keep.resolved || drop.resolved,
      acquisitionNote: keep.acquisitionNote ?? drop.acquisitionNote,
      giftedFrom: keep.giftedFrom ?? drop.giftedFrom,
      giftedTo: keep.giftedTo ?? drop.giftedTo,
    };
  };

  for (const g of games) {
    if (g.steamAppId == null) {
      const key = norm(g.title);
      if (unresolvedSeen.has(key)) continue;
      unresolvedSeen.add(key);
      unresolved.push(g);
      continue;
    }

    const prev = byApp.get(g.steamAppId);
    if (!prev) {
      byApp.set(g.steamAppId, g);
      continue;
    }

    const gPri = acquisitionPriority(g.kind);
    const pPri = acquisitionPriority(prev.kind);

    if (gPri > pPri) {
      byApp.set(g.steamAppId, mergeRows(g, prev));
    } else if (gPri < pPri) {
      byApp.set(g.steamAppId, mergeRows(prev, g));
    } else if (g.kind === "purchased") {
      byApp.set(g.steamAppId, mergeRows(
        { ...prev, paid: Math.max(prev.paid ?? 0, g.paid ?? 0) },
        g,
      ));
    } else {
      // Same priority — keep the priced / better-titled row
      const keep =
        (g.current != null && g.current > 0) ||
        (g.lowest != null && g.lowest > 0) ||
        g.resolved
          ? g
          : prev;
      const drop = keep === g ? prev : g;
      byApp.set(g.steamAppId, mergeRows(keep, drop));
    }
  }

  return [...byApp.values(), ...unresolved];
}

function sumNullable(a: number | null, b: number | null): number | null {
  if (a == null && b == null) return null;
  return (a ?? 0) + (b ?? 0);
}

function mergeIntoParent(parent: ValuationGame, dlc: ValuationGame): ValuationGame {
  const paid = sumNullable(parent.paid, dlc.paid);
  const current = sumNullable(parent.current, dlc.current);
  const lowest = sumNullable(parent.lowest, dlc.lowest);
  const kind =
    acquisitionPriority(dlc.kind) > acquisitionPriority(parent.kind)
      ? dlc.kind
      : parent.kind;
  // Prefer purchased if either paid money
  const effectiveKind =
    (parent.kind === "purchased" ||
      dlc.kind === "purchased" ||
      parent.kind === "bundle" ||
      dlc.kind === "bundle") &&
    paid != null &&
    paid > 0
      ? parent.kind === "bundle" || dlc.kind === "bundle"
        ? "bundle"
        : "purchased"
      : kind;

  return {
    ...parent,
    title: parent.title,
    steamAppId: parent.steamAppId ?? dlc.steamAppId,
    paid,
    current,
    lowest,
    onSale: parent.onSale || dlc.onSale,
    resolved: parent.resolved || dlc.resolved,
    kind: effectiveKind,
    isGift: effectiveKind === "gifted_by_me",
    isUnpaidShelf: isUnpaidKind(effectiveKind),
    acquisitionNote: parent.acquisitionNote ?? dlc.acquisitionNote,
  };
}

/**
 * Fold DLC rows into their base game for spent / now / lowest / cost-hr.
 * Uses Steam fullgame parents, with title-prefix fallback.
 */
export function foldDlcIntoParents(
  games: ValuationGame[],
  dlcToParent: Map<number, number>,
): ValuationGame[] {
  const byApp = new Map<number, ValuationGame>();
  const unresolved: ValuationGame[] = [];

  for (const g of games) {
    if (g.steamAppId == null) {
      unresolved.push(g);
      continue;
    }
    byApp.set(g.steamAppId, g);
  }

  const resolveParentId = (g: ValuationGame): number | null => {
    if (g.steamAppId == null) return null;
    const fromApi = dlcToParent.get(g.steamAppId);
    if (fromApi != null && fromApi !== g.steamAppId) return fromApi;
    return inferParentFromLibrary(g, [...byApp.values(), ...unresolved]);
  };

  // Multi-pass in case we ever see nested relationships (rare)
  let changed = true;
  let guard = 0;
  while (changed && guard < 5) {
    changed = false;
    guard += 1;
    for (const [appId, g] of [...byApp.entries()]) {
      const parentId = resolveParentId(g);
      if (parentId == null || parentId === appId) continue;
      const parent = byApp.get(parentId);
      if (!parent) {
        // Parent not in shelf — remint DLC under parent id so later merges work
        // Keep DLC title until a real parent row exists; skip fold.
        continue;
      }
      byApp.set(parentId, mergeIntoParent(parent, g));
      byApp.delete(appId);
      changed = true;
    }
  }

  // Title-prefix only for unresolved / leftover DLC without API parent in map
  for (const [appId, g] of [...byApp.entries()]) {
    if (dlcToParent.has(appId)) continue;
    const parentId = inferParentFromLibrary(g, [...byApp.values()]);
    if (parentId == null || parentId === appId) continue;
    const parent = byApp.get(parentId);
    if (!parent) continue;
    byApp.set(parentId, mergeIntoParent(parent, g));
    byApp.delete(appId);
  }

  // Unresolved rows (no Steam app id) still fold into a known parent by title
  // e.g. "Brotato - Abyssal Terrors" → Brotato when price search failed.
  const stillUnresolved: ValuationGame[] = [];
  for (const g of unresolved) {
    const parentId = inferParentFromLibrary(g, [...byApp.values()]);
    if (parentId == null) {
      stillUnresolved.push(g);
      continue;
    }
    const parent = byApp.get(parentId);
    if (!parent) {
      stillUnresolved.push(g);
      continue;
    }
    byApp.set(parentId, mergeIntoParent(parent, g));
  }

  return [...byApp.values(), ...stillUnresolved];
}

function inferParentFromLibrary(
  game: ValuationGame,
  candidates: ValuationGame[],
): number | null {
  const key = norm(game.title);
  let best: { appId: number; len: number } | null = null;
  for (const c of candidates) {
    if (c.steamAppId == null || c.steamAppId === game.steamAppId) continue;
    const p = norm(c.title);
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

export function buildLibraryValuation(
  purchases: PurchaseHistoryRow[],
  licenses: LicenseRow[],
  priceCache: PriceCache,
  spending: SpendingAnalytics,
  opts?: {
    dlcParents?: Map<number, number>;
    /** Owned / played titles (excl. family-only) to catch gifts missing from licenses scrape */
    ownedTitles?: string[];
    /** Titles imported from Steam gift emails */
    mailGiftTitles?: string[];
    /** Steam persona who sent each mail gift (norm title → name) */
    mailGiftSenders?: Map<string, string>;
  },
): LibraryValuation {
  const currency = spending.currency;
  const storeCurrency =
    priceCache.currency?.trim().toUpperCase() || currency.toUpperCase();
  const usdRate = currency === "USD" ? 1 : inferUsdToDisplayRate(priceCache);

  const libraryPaid = paidByTitle(purchases, { giftsOnly: false });
  const giftSentPaid = paidByTitle(purchases, { giftsOnly: true });
  const giftToByTitle = giftSentRecipients(purchases);
  const mailGiftTitles = opts?.mailGiftTitles ?? [];
  const mailGiftSenders = opts?.mailGiftSenders;
  const libraryTitles = [
    ...new Set([
      ...libraryTitlesForValuation(purchases, licenses),
      ...(opts?.ownedTitles ?? []),
      ...mailGiftTitles,
    ]),
  ];
  const sentTitles = giftSentTitles(purchases);
  const ownedKeys = new Set((opts?.ownedTitles ?? []).map(norm));
  const libraryTitleKeys = libraryTitles.map(norm);

  const games: ValuationGame[] = [];
  const giftsSentGames: ValuationGame[] = [];
  const unresolvedTitles: string[] = [];
  const seenLib = new Set<string>();

  for (const title of libraryTitles) {
    const key = norm(title);
    if (seenLib.has(key)) continue;
    seenLib.add(key);

    const quote = findQuote(priceCache, title);
    const priceHint = quote
      ? {
          current:
            currency.toUpperCase() === "USD" &&
            storeCurrency !== "USD"
              ? quote.currentUsd
              : (quote.currentInr ?? quote.currentUsd),
          retail:
            currency.toUpperCase() === "USD" &&
            storeCurrency !== "USD"
              ? quote.retailUsd
              : (quote.retailInr ?? quote.retailUsd),
        }
      : undefined;

    const classified = classifyAcquisition({
      title,
      licenses,
      purchases,
      paidByExact: libraryPaid,
      ownedKeys,
      libraryTitleKeys,
      mailGiftTitles,
      mailGiftSenders,
      priceHint,
    });

    const giftedFrom =
      classified.kind === "gifted_to_me"
        ? mailGiftSenders?.get(norm(title)) ||
          [...(mailGiftSenders?.entries() ?? [])].find(
            ([k]) => titlesSoftMatch(k, title),
          )?.[1]
        : undefined;

    games.push(
      priceGame(
        title,
        classified.paid,
        classified.kind,
        priceCache,
        currency,
        usdRate,
        storeCurrency,
        unresolvedTitles,
        classified.note,
        giftedFrom ? { giftedFrom } : undefined,
      ),
    );
  }

  const seenSent = new Set<string>();
  for (const title of sentTitles) {
    const key = norm(title);
    if (seenSent.has(key)) continue;
    seenSent.add(key);
    const paid = giftSentPaid.get(key) ?? null;
    const giftedTo =
      giftToByTitle.get(key) ||
      [...giftToByTitle.entries()].find(([k]) => titlesSoftMatch(k, title))?.[1];
    giftsSentGames.push(
      priceGame(
        title,
        paid,
        "gifted_by_me",
        priceCache,
        currency,
        usdRate,
        storeCurrency,
        unresolvedTitles,
        giftedTo ? `Gifted to ${giftedTo}` : undefined,
        giftedTo ? { giftedTo } : undefined,
      ),
    );
  }

  const merged = clearBundleShelfPrices(
    foldEditionPacksIntoBase(
      foldDlcIntoParents(dedupeLibraryGames(games), opts?.dlcParents ?? new Map()),
    ),
  );
  merged.sort((a, b) => (b.paid ?? 0) - (a.paid ?? 0));
  const giftsMerged = clearBundleShelfPrices(
    foldEditionPacksIntoBase(
      foldDlcIntoParents(
        dedupeLibraryGames(giftsSentGames),
        opts?.dlcParents ?? new Map(),
      ),
    ),
  );
  giftsMerged.sort((a, b) => (b.paid ?? 0) - (a.paid ?? 0));

  const isLibrary = (g: ValuationGame) => g.kind !== "gifted_by_me";
  const isPaidShelf = (g: ValuationGame) =>
    g.kind === "purchased" || g.kind === "bundle";
  const isUnpaid = (g: ValuationGame) => g.isUnpaidShelf;

  const shelfFull = sumShelf(merged, isLibrary);
  shelfFull.spent = spending.netSpent;

  const shelfPaidOnly = sumShelf(merged, isPaidShelf);
  shelfPaidOnly.spent = spending.netSpent;

  const shelfExcludingReceivedGifts = sumShelf(
    merged,
    (g) => isLibrary(g) && g.kind !== "gifted_to_me",
  );
  shelfExcludingReceivedGifts.spent = spending.netSpent;

  const unpaidShelf = sumShelf(merged, isUnpaid);
  unpaidShelf.spent = 0;

  const giftsSent = sumShelf(giftsMerged, () => true);
  giftsSent.spent = spending.giftSpend;

  const giftsReceivedGames = sortByShelfValue(
    merged.filter((g) => g.kind === "gifted_to_me"),
  );
  const freeGames = sortByShelfValue(merged.filter((g) => g.kind === "free"));
  const bundleGames = sortByShelfValue(
    merged.filter((g) => g.kind === "bundle"),
  );
  const ownershipGrantGames = sortByShelfValue(
    merged.filter((g) => g.kind === "ownership_grant"),
  );
  const unknownUnpaidGames = sortByShelfValue(
    merged.filter((g) => g.kind === "unknown_unpaid"),
  );

  const giftsReceived = sumShelf(giftsReceivedGames, () => true);
  giftsReceived.spent = 0;

  const toDisplay = (usd: number | null | undefined) => {
    if (usd == null) return null;
    if (currency === "USD") return usd;
    if (usdRate == null) return null;
    return usd * usdRate;
  };

  const note =
    "Spent is what you paid for your library. Shelf now values playable games only (not collections/bundles). Remasters and alternate editions fold into one row (remaster preferred — originals are not double-counted). Bundles attribute cost to included titles when the checkout lists the pack. Gifts received come from Steam Gift/Guest Pass and/or Gmail sync. DLC rolls into the base when both are owned. Lowest is the Steam store all-time low via IsThereAnyDeal, refreshed at most weekly and stored locally. Free titles count as 0 for lowest. Gifts you sent are separate.";

  // Back-compat: excludingGifts ≈ full library shelf; includingGifts ignored for heroes
  const excludingGifts = shelfFull;
  const includingGifts = {
    spent: shelfFull.spent + giftsSent.spent,
    current: shelfFull.current,
    lowest: shelfFull.lowest,
    titlesResolved: shelfFull.titlesResolved,
    titlesConsidered: shelfFull.titlesConsidered,
  };
  const giftOnly = giftsSent;

  return {
    currency,
    usdToDisplayRate: usdRate,
    librarySpent: spending.netSpent,
    shelfFull,
    shelfPaidOnly,
    shelfExcludingReceivedGifts,
    unpaidShelf,
    giftsSent,
    giftsReceived,
    games: merged,
    giftsSentGames: giftsMerged,
    giftsReceivedGames,
    freeGames,
    bundleGames,
    ownershipGrantGames,
    unknownUnpaidGames,
    unresolvedTitles,
    note,
    valveTotalSpend: toDisplay(spending.valveSpendUsd.totalSpend),
    valvePackageSpend: toDisplay(spending.valveSpendUsd.packageOnlySpend),
    valvePackageSavings: toDisplay(spending.valveSpendUsd.packageOnlySavings),
    excludingGifts,
    includingGifts,
    giftOnly,
    deltaCurrentVsLowestExcl: shelfFull.current - shelfFull.lowest,
    deltaCurrentVsLowestIncl: shelfFull.current - shelfFull.lowest,
    paidVsCurrentExcl: spending.netSpent - shelfFull.current,
    paidVsCurrentIncl: spending.netSpent - shelfFull.current,
    currentValue: shelfFull.current,
    lowestValue: shelfFull.lowest,
    titlesConsidered: shelfFull.titlesConsidered,
    titlesResolved: shelfFull.titlesResolved,
    titlesWithLocalPrice: shelfFull.titlesResolved,
    paidVsCurrent: spending.netSpent - shelfFull.current,
    deltaCurrentVsLowest: shelfFull.current - shelfFull.lowest,
  };
}
