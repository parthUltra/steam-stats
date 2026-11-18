import type { LicenseRow, PurchaseHistoryRow } from "@/lib/account-data";
import {
  buildAcquisitionIndex,
  classifyAcquisition,
  titlesSoftMatch,
  type AcquisitionKind,
} from "@/lib/analytics/acquisition";
import {
  giftSentTitlesFromPurchases,
  isGiftPurchase,
  isKeptGameItem,
  isTrackableGamePurchase,
  libraryTitlesForValuation,
  moneyOf,
  purchaseParts,
  type SpendingAnalytics,
} from "@/lib/analytics/spending";
import {
  clearBundleShelfPrices,
  foldEditionPacksIntoBase,
  isRedundantPackSku,
  mergeEditionIntoBase,
  sumNullable,
} from "@/lib/analytics/edition-packs";
import { isGiftCardName, normTitle as norm } from "@/lib/titles";
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
  /**
   * When a gift reached you: the Steam licence date ("YYYY-MM-DD") or the gift
   * e-mail's timestamp (ISO 8601). Absent when unknown.
   */
  receivedAt?: string;
  /** When `lowest` was recorded (ISO 8601), if the price source said. */
  lowestRecordedAt?: string;
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
  /** 1 for a USD account, else null. Local prices are never derived from USD. */
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
  /**
   * Every title that was looked up without getting a store quote — including
   * store SKUs later folded into a priced row and gifts sent. For "how many
   * shelf titles have no price" use `shelfTitlesUnpriced` instead.
   */
  unresolvedTitles: string[];
  /**
   * One consistent set of counts over the library rows that `shelfFull`
   * actually sums (multi-game packs whose games are on the shelf excluded):
   * `shelfTitles === shelfTitlesPriced + shelfTitlesUnpriced`.
   * Priced = has a store price (or is a free title, worth 0).
   */
  shelfTitles: number;
  shelfTitlesPriced: number;
  shelfTitlesUnpriced: number;
  /** Titles of the unpriced shelf rows, A–Z. */
  shelfUnpricedTitles: string[];
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
        if (!isKeptGameItem(row, line.name)) continue;
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

    // No line amounts: an even share per game (gift cards take their own share)
    const amount = gift ? moneyOf(row) : purchaseParts(row).game;
    if (amount <= 0 || row.items.length === 0) continue;
    const usable = row.items.filter((i) => isKeptGameItem(row, i));
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

/**
 * Live store price in the display currency. Only the store's own quote is
 * used: the display currency is the store currency (`currentInr`), or a USD
 * account reads the genuine US-store amount. A local price is never derived
 * from a USD one — the old "rate" was a regional price ratio, not FX.
 */
function quoteCurrentInCurrency(
  quote: GamePriceQuote,
  currency: string,
  storeCurrency: string,
): number | null {
  const displayCur = currency.toUpperCase();
  const raw =
    displayCur === storeCurrency.toUpperCase()
      ? quote.currentInr
      : displayCur === "USD"
        ? (quote.usd?.current ?? null)
        : null;
  // 0 / missing store price → treat as unlisted (show "—", fall back to low)
  if (raw == null || raw <= 0) return null;
  return raw;
}

function quoteLowestInCurrency(
  quote: GamePriceQuote,
  currency: string,
  currentLocal: number | null,
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

/** Norm title → Steam persona you gifted to (last wins if duplicates). */
function giftSentRecipients(
  purchases: PurchaseHistoryRow[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of purchases) {
    if (!isGiftPurchase(row) || row.refunded) continue;
    const to = row.giftRecipient?.trim();
    if (!to) continue;
    // The parser always sets lineItems (possibly []), so test its length
    const names = row.lineItems?.length
      ? row.lineItems.map((l) => l.name)
      : row.items;
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
  storeCurrency: string,
  unresolvedTitles: string[],
  acquisitionNote?: string,
  giftPeople?: { giftedFrom?: string; giftedTo?: string; receivedAt?: string },
): ValuationGame {
  const quote = findQuote(priceCache, title);
  const isGift = kind === "gifted_by_me";
  const isUnpaidShelf = isUnpaidKind(kind);
  const giftedFrom = giftPeople?.giftedFrom;
  const giftedTo = giftPeople?.giftedTo;
  const received = giftPeople?.receivedAt
    ? { receivedAt: giftPeople.receivedAt }
    : {};

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
      ...received,
    };
  }

  const current = quoteCurrentInCurrency(quote, currency, storeCurrency);
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
      ...received,
    };
  }

  let lowest = quoteLowestInCurrency(quote, currency, current, storeCurrency);
  if (lowest == null) {
    const related = relatedEditionIndiaLow(
      priceCache,
      quote.title || title,
      norm(quote.title || title),
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
    ...received,
    // Only when this row's low is the quote's own (not a related edition's)
    ...(quote.lowestRecordedAt && lowest != null && lowest === quote.lowestInr
      ? { lowestRecordedAt: quote.lowestRecordedAt }
      : {}),
  };
}

function acquisitionPriority(kind: AcquisitionKind): number {
  if (kind === "purchased" || kind === "bundle") return 4;
  if (kind === "gifted_to_me") return 3;
  if (kind === "ownership_grant") return 2;
  if (kind === "free") return 1;
  if (kind === "unknown_unpaid") return 1;
  return 0;
}

/**
 * Rows whose cost basis is another row's purchase line (a soft match: the
 * playtime title "Titanfall 2" vs the checkout line "Titanfall 2: Ultimate
 * Edition") are the same game. Merge each into the row that owns the line so
 * the amount is counted once and one shelf price is kept.
 */
function mergeSoftLinkedRows(
  rows: { key: string; game: ValuationGame }[],
  links: { key: string; ownerKey: string }[],
): ValuationGame[] {
  const byKey = new Map(rows.map((r) => [r.key, r.game]));
  const mergedInto = new Map<string, string>();
  const rootOf = (key: string) => {
    let k = key;
    while (mergedInto.has(k)) k = mergedInto.get(k)!;
    return k;
  };
  for (const link of links) {
    const from = rootOf(link.key);
    const into = rootOf(link.ownerKey);
    if (from === into) continue;
    const a = byKey.get(from);
    const b = byKey.get(into);
    if (!a || !b) continue;
    byKey.set(into, mergeEditionIntoBase(b, a));
    byKey.delete(from);
    mergedInto.set(from, into);
  }
  return [...byKey.values()];
}

/**
 * Collapse DLC / quote-title collisions onto one shelf row per app.
 * Paid is summed: each purchase line sits on exactly one row, so two rows that
 * both carry paid are two purchases (a game and its DLC quoted as one app).
 */
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
      paid: sumNullable(keep.paid, drop.paid),
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
      receivedAt: keep.receivedAt ?? drop.receivedAt,
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
      byApp.set(g.steamAppId, mergeRows(prev, g));
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
 *
 * A row with a Steam app id folds only when Steam's DLC map (`dlcToParent`,
 * from data/dlc-parents.json) names its parent — a title prefix is not
 * evidence: "Hollow Knight: Silksong" and "Half-Life 2: Deathmatch" are games.
 * A row with no app id cannot be looked up, so it alone falls back to the
 * title, and only for the "Base - Add-on" naming Steam uses for DLC.
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

  // Multi-pass in case we ever see nested relationships (rare)
  let changed = true;
  let guard = 0;
  while (changed && guard < 5) {
    changed = false;
    guard += 1;
    for (const [appId, g] of [...byApp.entries()]) {
      const parentId = dlcToParent.get(appId);
      if (parentId == null || parentId === appId) continue;
      // Parent not on the shelf — keep the DLC row as it is
      const parent = byApp.get(parentId);
      if (!parent) continue;
      byApp.set(parentId, mergeIntoParent(parent, g));
      byApp.delete(appId);
      changed = true;
    }
  }

  // e.g. "Brotato - Abyssal Terrors" → Brotato when the price search failed
  const stillUnresolved: ValuationGame[] = [];
  for (const g of unresolved) {
    const parentId = inferAddOnParent(g, [...byApp.values()]);
    const parent = parentId == null ? undefined : byApp.get(parentId);
    if (parentId == null || !parent) {
      stillUnresolved.push(g);
      continue;
    }
    byApp.set(parentId, mergeIntoParent(parent, g));
  }

  return [...byApp.values(), ...stillUnresolved];
}

/** Parent of an unpriced "Base - Add-on" row: the longest base title on the shelf. */
function inferAddOnParent(
  game: ValuationGame,
  candidates: ValuationGame[],
): number | null {
  const key = norm(game.title);
  let best: { appId: number; len: number } | null = null;
  for (const c of candidates) {
    if (c.steamAppId == null) continue;
    const p = norm(c.title);
    if (p.length < 4 || p === key) continue;
    if (
      !key.startsWith(`${p} -`) &&
      !key.startsWith(`${p} –`) &&
      !key.startsWith(`${p} —`)
    ) {
      continue;
    }
    // An edition of the same game is the edition fold's job (it never sums prices)
    if (titlesSoftMatch(c.title, game.title)) continue;
    if (!best || p.length > best.len) {
      best = { appId: c.steamAppId, len: p.length };
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
    /** When each mail gift arrived (norm title → ISO 8601) */
    mailGiftReceivedAt?: Map<string, string>;
  },
): LibraryValuation {
  const currency = spending.currency;
  const storeCurrency =
    priceCache.currency?.trim().toUpperCase() || currency.toUpperCase();
  const displayIsUsd = currency.toUpperCase() === "USD";

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
  const sentTitles = giftSentTitlesFromPurchases(purchases);
  const ownedKeys = new Set((opts?.ownedTitles ?? []).map(norm));
  const libraryTitleKeys = libraryTitles.map(norm);
  const acquisitionIndex = buildAcquisitionIndex(licenses, purchases);

  const libraryRows: { key: string; game: ValuationGame }[] = [];
  // Rows whose cost basis is another row's purchase line (edition / SKU match)
  const softLinks: { key: string; ownerKey: string }[] = [];
  const libraryKeySet = new Set(libraryTitleKeys);
  const claimedPurchaseLines = new Set<string>();
  const giftsSentGames: ValuationGame[] = [];
  const unresolvedTitles: string[] = [];
  const seenLib = new Set<string>();

  for (const title of libraryTitles) {
    const key = norm(title);
    if (seenLib.has(key)) continue;
    seenLib.add(key);

    const quote = findQuote(priceCache, title);
    const usdQuote = displayIsUsd && storeCurrency !== "USD";
    const priceHint = quote
      ? {
          current: usdQuote ? (quote.usd?.current ?? null) : quote.currentInr,
          retail: usdQuote ? (quote.usd?.retail ?? null) : quote.retailInr,
          isFree: quote.isFree,
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
      index: acquisitionIndex,
    });

    const giftedFrom =
      classified.kind === "gifted_to_me"
        ? mailGiftSenders?.get(norm(title)) ||
          [...(mailGiftSenders?.entries() ?? [])].find(
            ([k]) => titlesSoftMatch(k, title),
          )?.[1]
        : undefined;
    const receivedAt =
      classified.kind === "gifted_to_me"
        ? (classified.receivedAt ??
          opts?.mailGiftReceivedAt?.get(norm(title)) ??
          [...(opts?.mailGiftReceivedAt?.entries() ?? [])].find(([k]) =>
            titlesSoftMatch(k, title),
          )?.[1])
        : undefined;

    // One purchase line → one row. A soft match means the amount belongs to
    // another title's checkout line: if that line has its own row, it keeps
    // the money and this row is merged into it below; otherwise the first
    // title to claim the line carries it.
    let paid = classified.paid;
    const ownerKey = classified.coveredBy;
    if (classified.paidVia === "soft" && ownerKey) {
      if (libraryKeySet.has(ownerKey) && ownerKey !== key) {
        paid = null;
        softLinks.push({ key, ownerKey });
      } else if (claimedPurchaseLines.has(ownerKey)) {
        paid = null;
      } else {
        claimedPurchaseLines.add(ownerKey);
      }
    }

    libraryRows.push({
      key,
      game: priceGame(
        title,
        paid,
        classified.kind,
        priceCache,
        currency,
        storeCurrency,
        unresolvedTitles,
        classified.note,
        giftedFrom || receivedAt ? { giftedFrom, receivedAt } : undefined,
      ),
    });
  }
  const games = mergeSoftLinkedRows(libraryRows, softLinks);

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

  // The same rows sumShelf adds up, counted once.
  const shelfRows = merged.filter(
    (g) => isLibrary(g) && !isRedundantPackSku(g, merged),
  );
  const isPricedRow = (g: ValuationGame) =>
    g.resolved && (g.kind === "free" || effectiveShelfNow(g) != null);
  const shelfUnpricedTitles = shelfRows
    .filter((g) => !isPricedRow(g))
    .map((g) => g.title)
    .sort((a, b) => a.localeCompare(b));

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

  // Valve reports these in USD. They are shown only on a USD account: there
  // is no exchange rate here, and a regional price ratio is not one.
  const toDisplay = (usd: number | null | undefined) =>
    usd != null && displayIsUsd ? usd : null;

  const note =
    "Spent is what you paid for your library. Shelf now values playable games only (not collections/bundles). Remasters and alternate editions fold into one row (remaster preferred — originals are not double-counted). A collection / bundle keeps its price on the pack row; cost per hour splits it across the games it includes. Gifts received come from Steam Gift/Guest Pass and/or Gmail sync. DLC rolls into the base when both are owned and Steam lists it as that game's DLC. Lowest is the Steam store all-time low via IsThereAnyDeal, refreshed at most weekly and stored locally. Free titles count as 0 for lowest. Gifts you sent are separate.";

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
    usdToDisplayRate: displayIsUsd ? 1 : null,
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
    shelfTitles: shelfRows.length,
    shelfTitlesPriced: shelfRows.length - shelfUnpricedTitles.length,
    shelfTitlesUnpriced: shelfUnpricedTitles.length,
    shelfUnpricedTitles,
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
