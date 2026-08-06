import type { LicenseRow, PurchaseHistoryRow } from "@/lib/account-data";
import {
  isGiftPurchase,
  isGiftReceivedLicense,
  isOwnedLibraryLicense,
  isTrackableGamePurchase,
  libraryTitlesForValuation,
  moneyOf,
  type SpendingAnalytics,
} from "@/lib/analytics/spending";
import { foldEditionPacksIntoBase } from "@/lib/analytics/edition-packs";
import type { GamePriceQuote, PriceCache } from "@/lib/pricing/prices";

/** How this title relates to your wallet / shelf. */
export type AcquisitionKind =
  | "purchased"
  | "gifted_to_me"
  | "free"
  | "gifted_by_me";

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
  /** Gifted to you or permanent free — counts in shelf, not spent */
  isUnpaidShelf: boolean;
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
  /** Free + gifted-to-you contribution to shelf */
  unpaidShelf: ValueSlice;
  /** Money you spent buying gifts for others (not in library) */
  giftsSent: ValueSlice;
  games: ValuationGame[];
  giftsSentGames: ValuationGame[];
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
  return title
    .toLowerCase()
    .replace(/™|®/g, "")
    .replace(/\s+/g, " ")
    .trim();
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

  for (const row of purchases) {
    const gift = isGiftPurchase(row);
    if (giftsOnly) {
      if (!gift || row.refunded) continue;
    } else if (!isTrackableGamePurchase(row)) {
      continue;
    }

    if (row.lineItems?.length) {
      for (const line of row.lineItems) {
        if (line.amount == null || line.amount < 0) continue;
        if (isGiftCardName(line.name)) continue;
        const key = norm(line.name);
        map.set(key, (map.get(key) ?? 0) + line.amount);
      }
      continue;
    }

    const amount = moneyOf(row);
    if (amount <= 0 || row.items.length === 0) continue;
    const usable = row.items.filter((i) => !isGiftCardName(i));
    if (!usable.length) continue;
    const share = amount / usable.length;
    for (const item of usable) {
      const key = norm(item);
      map.set(key, (map.get(key) ?? 0) + share);
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
    if (
      q.currentUsd != null &&
      q.currentUsd > 0 &&
      q.currentInr != null &&
      q.currentInr > 0
    ) {
      ratios.push(q.currentInr / q.currentUsd);
    }
  }
  return median(ratios);
}

function quoteCurrentInCurrency(
  quote: GamePriceQuote,
  currency: string,
  usdRate: number | null,
): number | null {
  let raw: number | null = null;
  if (currency === "INR") {
    if (quote.currentInr != null) raw = quote.currentInr;
    else if (quote.currentUsd != null && usdRate != null) {
      raw = quote.currentUsd * usdRate;
    }
  } else if (currency === "USD") {
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
  usdRate: number | null,
): number | null {
  const lowestUsd = quote.lowestUsd;
  const currentUsd =
    quote.currentUsd != null && quote.currentUsd > 0 ? quote.currentUsd : null;

  if (currency === "USD") {
    return lowestUsd ?? currentLocal ?? currentUsd;
  }

  if (
    currentLocal != null &&
    lowestUsd != null &&
    currentUsd != null &&
    currentUsd > 0
  ) {
    return currentLocal * (lowestUsd / currentUsd);
  }
  if (lowestUsd != null && usdRate != null) return lowestUsd * usdRate;
  // Delisted: still use scaled historical low or fall back to null
  return currentLocal;
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

function findQuote(
  priceCache: PriceCache,
  title: string,
): GamePriceQuote | undefined {
  const key = norm(title);
  if (priceCache.quotes[key]) return priceCache.quotes[key];
  for (const [k, q] of Object.entries(priceCache.quotes)) {
    if (k.includes(key) || key.includes(k)) return q;
  }
  return undefined;
}

function giftSentTitles(purchases: PurchaseHistoryRow[]): string[] {
  const titles = new Set<string>();
  for (const row of purchases) {
    if (!isGiftPurchase(row) || row.refunded) continue;
    const names = row.lineItems?.map((l) => l.name) ?? row.items ?? [];
    for (const name of names) {
      if (!name || isGiftCardName(name)) continue;
      titles.add(name);
    }
  }
  return [...titles];
}

function giftReceivedTitles(licenses: LicenseRow[]): Set<string> {
  const set = new Set<string>();
  for (const lic of licenses) {
    if (!isGiftReceivedLicense(lic)) continue;
    const t = lic.item.trim();
    if (t) set.add(norm(t));
  }
  return set;
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
    titlesConsidered += 1;
    if (g.paid != null) spent += g.paid;
    if (!g.resolved) continue;
    titlesResolved += 1;
    const now = effectiveShelfNow(g);
    if (now != null) current += now;
    if (g.lowest != null && g.lowest > 0) lowest += g.lowest;
    else if (now != null) lowest += now;
  }

  return { spent, current, lowest, titlesResolved, titlesConsidered };
}

function priceGame(
  title: string,
  paid: number | null,
  kind: AcquisitionKind,
  priceCache: PriceCache,
  currency: string,
  usdRate: number | null,
  unresolvedTitles: string[],
): ValuationGame {
  const quote = findQuote(priceCache, title);
  const isGift = kind === "gifted_by_me";
  const isUnpaidShelf = kind === "gifted_to_me" || kind === "free";

  if (!quote || quote.source === "unresolved" || quote.steamAppId == null) {
    unresolvedTitles.push(quote?.title ?? title);
    return {
      title: quote?.title ?? title,
      paid,
      current: null,
      lowest: null,
      steamAppId: null,
      onSale: false,
      resolved: false,
      kind,
      isGift,
      isUnpaidShelf,
    };
  }

  const current = quoteCurrentInCurrency(quote, currency, usdRate);
  let lowest = quoteLowestInCurrency(quote, currency, current, usdRate);
  // If low is missing but we somehow only have a positive current, mirror it
  if ((lowest == null || lowest <= 0) && current != null && current > 0) {
    lowest = current;
  }
  if (lowest != null && lowest <= 0) lowest = null;

  return {
    title: quote.title,
    paid,
    current,
    lowest,
    steamAppId: quote.steamAppId,
    onSale: quote.onSale,
    resolved: true,
    kind,
    isGift,
    isUnpaidShelf,
  };
}

function acquisitionPriority(kind: AcquisitionKind): number {
  if (kind === "purchased") return 3;
  if (kind === "gifted_to_me") return 2;
  if (kind === "free") return 1;
  return 0;
}

/** Collapse DLC / quote-title collisions onto one shelf row per app. */
function dedupeLibraryGames(games: ValuationGame[]): ValuationGame[] {
  const byApp = new Map<number, ValuationGame>();
  const unresolved: ValuationGame[] = [];
  const unresolvedSeen = new Set<string>();

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
      byApp.set(g.steamAppId, {
        ...g,
        paid:
          g.kind === "purchased"
            ? Math.max(g.paid ?? 0, prev.kind === "purchased" ? prev.paid ?? 0 : 0)
            : g.paid,
      });
    } else if (gPri === pPri && g.kind === "purchased") {
      byApp.set(g.steamAppId, {
        ...prev,
        paid: Math.max(prev.paid ?? 0, g.paid ?? 0),
        onSale: prev.onSale || g.onSale,
      });
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
    (parent.kind === "purchased" || dlc.kind === "purchased") &&
    paid != null &&
    paid > 0
      ? "purchased"
      : kind;

  return {
    ...parent,
    title: parent.title,
    steamAppId: parent.steamAppId,
    paid,
    current,
    lowest,
    onSale: parent.onSale || dlc.onSale,
    resolved: parent.resolved || dlc.resolved,
    kind: effectiveKind,
    isGift: effectiveKind === "gifted_by_me",
    isUnpaidShelf: effectiveKind === "gifted_to_me" || effectiveKind === "free",
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

  return [...byApp.values(), ...unresolved];
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
  opts?: { dlcParents?: Map<number, number> },
): LibraryValuation {
  const currency = spending.currency;
  const usdRate = currency === "USD" ? 1 : inferUsdToDisplayRate(priceCache);

  const libraryPaid = paidByTitle(purchases, { giftsOnly: false });
  const giftSentPaid = paidByTitle(purchases, { giftsOnly: true });
  const libraryTitles = libraryTitlesForValuation(purchases, licenses);
  const receivedKeys = giftReceivedTitles(licenses);
  const sentTitles = giftSentTitles(purchases);

  const games: ValuationGame[] = [];
  const giftsSentGames: ValuationGame[] = [];
  const unresolvedTitles: string[] = [];
  const seenLib = new Set<string>();

  for (const title of libraryTitles) {
    const key = norm(title);
    if (seenLib.has(key)) continue;
    seenLib.add(key);

    const paidAmount = libraryPaid.get(key) ?? null;
    let kind: AcquisitionKind;
    let paid: number | null;

    if (receivedKeys.has(key) && !(paidAmount != null && paidAmount > 0)) {
      kind = "gifted_to_me";
      paid = 0;
    } else if (paidAmount != null && paidAmount > 0) {
      kind = "purchased";
      paid = paidAmount;
    } else if (receivedKeys.has(key)) {
      kind = "gifted_to_me";
      paid = 0;
    } else if (
      licenses.some(
        (l) => isOwnedLibraryLicense(l) && norm(l.item) === key,
      ) &&
      !(paidAmount != null && paidAmount > 0)
    ) {
      // Owned via license with no purchase line — free / complimentary kept
      const lic = licenses.find(
        (l) => isOwnedLibraryLicense(l) && norm(l.item) === key,
      );
      kind = lic && isGiftReceivedLicense(lic) ? "gifted_to_me" : "free";
      paid = 0;
    } else {
      kind = "purchased";
      paid = paidAmount;
    }

    games.push(
      priceGame(title, paid, kind, priceCache, currency, usdRate, unresolvedTitles),
    );
  }

  const seenSent = new Set<string>();
  for (const title of sentTitles) {
    const key = norm(title);
    if (seenSent.has(key)) continue;
    seenSent.add(key);
    const paid = giftSentPaid.get(key) ?? null;
    giftsSentGames.push(
      priceGame(
        title,
        paid,
        "gifted_by_me",
        priceCache,
        currency,
        usdRate,
        unresolvedTitles,
      ),
    );
  }

  const merged = foldEditionPacksIntoBase(
    foldDlcIntoParents(dedupeLibraryGames(games), opts?.dlcParents ?? new Map()),
  );
  merged.sort((a, b) => (b.paid ?? 0) - (a.paid ?? 0));
  const giftsMerged = foldEditionPacksIntoBase(
    foldDlcIntoParents(
      dedupeLibraryGames(giftsSentGames),
      opts?.dlcParents ?? new Map(),
    ),
  );
  giftsMerged.sort((a, b) => (b.paid ?? 0) - (a.paid ?? 0));

  const isLibrary = (g: ValuationGame) => g.kind !== "gifted_by_me";
  const isPaidShelf = (g: ValuationGame) => g.kind === "purchased";
  const isUnpaid = (g: ValuationGame) => g.isUnpaidShelf;

  const shelfFull = sumShelf(merged, isLibrary);
  shelfFull.spent = spending.netSpent;

  const shelfPaidOnly = sumShelf(merged, isPaidShelf);
  shelfPaidOnly.spent = spending.netSpent;

  const unpaidShelf = sumShelf(merged, isUnpaid);
  unpaidShelf.spent = 0;

  const giftsSent = sumShelf(giftsMerged, () => true);
  giftsSent.spent = spending.giftSpend;

  const toDisplay = (usd: number | null | undefined) => {
    if (usd == null) return null;
    if (currency === "USD") return usd;
    if (usdRate == null) return null;
    return usd * usdRate;
  };

  const note =
    usdRate != null && currency !== "USD"
      ? `Spent is what you paid for your library. DLC and edition packs (Complete/GOTY/etc.) roll into the base game when both are owned. Now/lowest default to your full kept shelf (incl. free & gifted-to-you). Gifts you sent are separate. Lows use ~${usdRate.toFixed(2)} ${currency}/USD when needed.`
      : "Spent is what you paid for your library. DLC and edition packs (Complete/GOTY/etc.) roll into the base game when both are owned. Now/lowest default to your full kept shelf (incl. free & gifted-to-you). Gifts you sent are separate.";

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
    unpaidShelf,
    giftsSent,
    games: merged,
    giftsSentGames: giftsMerged,
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
