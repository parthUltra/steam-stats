import { format } from "date-fns";
import type { LicenseRow, PurchaseHistoryRow } from "@/lib/account-data";
import { parseSteamDate } from "@/lib/dates";
import {
  isGiftCardName,
  isSequelRemainder,
  median,
  normTitle,
} from "@/lib/titles";

// Re-exported: the stats modules import the date parser from here.
export { parseSteamDate };

export function isGiftPurchase(row: PurchaseHistoryRow): boolean {
  if (row.isGift) return true;
  const blob = row.items.join(" ").toLowerCase();
  return blob.includes("gift sent to");
}

export function isTrackableGamePurchase(row: PurchaseHistoryRow): boolean {
  if (row.refunded) return false;
  if (!/purchase/i.test(row.type)) return false;
  if (isGiftPurchase(row)) return false;
  const blob = row.items.join(" ").toLowerCase();
  // A checkout of only gift cards is not a game purchase; a mixed one is.
  if (row.items.length > 0 && row.items.every(isGiftCardName)) return false;
  if (blob.includes("steam community market")) return false;
  if (blob === "refund") return false;
  if (blob.includes("wallet credit")) return false;
  return row.items.length > 0;
}

/** Title/license names that are trials, passes, demos — not lasting ownership. */
export function isTemporaryLibraryItem(item: string): boolean {
  const t = item.toLowerCase();
  return /free weekend|free on demand|promotional package|limited free|demo\b|playtest|temporary content|\bguest pass\b|\bfree pass\b|\bfree trial\b|\bplay first\b|\bopen beta\b|\bclosed beta\b|\bea play\b|\bfamily (sharing|library|group)\b/.test(
    t,
  );
}

/** Licenses that are temporary / not lasting ownership. */
export function isTemporaryLibraryLicense(license: LicenseRow): boolean {
  if (isTemporaryLibraryItem(license.item)) return true;
  const method = (license.acquisitionMethod || "").toLowerCase();
  return /\bfamily (sharing|library)\b/.test(method);
}

/** Licenses that represent games kept in your library (not free weekends/promos). */
export function isOwnedLibraryLicense(license: LicenseRow): boolean {
  if (isTemporaryLibraryLicense(license)) return false;
  const method = (license.acquisitionMethod || "").toLowerCase();
  // Complimentary leftovers after temp filter = kept free games / DLC
  if (method.includes("complimentary")) return true;
  if (method.includes("gift")) return true;
  if (method.includes("steam store") || method.includes("retail")) return true;
  // Unknown methods: keep unless temporary
  return Boolean(license.item.trim());
}

/** Gift received into your library (not a guest pass, not gifts you sent). */
export function isGiftReceivedLicense(license: LicenseRow): boolean {
  if (!isOwnedLibraryLicense(license)) return false;
  if (/\bguest pass\b/i.test(license.item)) return false;
  const method = (license.acquisitionMethod || "").toLowerCase();
  return /\bgift\b/.test(method);
}

export function moneyOf(row: PurchaseHistoryRow): number {
  return row.total?.amount ?? row.price?.amount ?? 0;
}

/**
 * True when this item of a partially refunded checkout was refunded. (A fully
 * refunded row has `refunded: true` and is skipped as a whole.)
 */
export function isRefundedItem(row: PurchaseHistoryRow, name: string): boolean {
  if (!row.partiallyRefunded || !row.refundedItems?.length) return false;
  const key = normTitle(name);
  return row.refundedItems.some((r) => normTitle(r) === key);
}

/** A game item still owned from this checkout: not a gift card, not refunded. */
export function isKeptGameItem(row: PurchaseHistoryRow, name: string): boolean {
  return !isGiftCardName(name) && !isRefundedItem(row, name);
}

/**
 * One checkout split into the part that bought (kept) games, the part that
 * bought gift cards and the part that was refunded (partial refund). Uses line
 * amounts when the row has them, otherwise an even share per item.
 */
export function purchaseParts(row: PurchaseHistoryRow): {
  game: number;
  giftCard: number;
  refunded: number;
} {
  const amount = moneyOf(row);
  const kind = (name: string) =>
    isGiftCardName(name) ? "giftCard" : isRefundedItem(row, name) ? "refunded" : "game";

  const parts = { giftCard: 0, refunded: 0 };
  if (row.lineItems?.length) {
    for (const l of row.lineItems) {
      const k = kind(l.name);
      if (k !== "game") parts[k] += Math.max(l.amount ?? 0, 0);
    }
  } else if (row.items.length) {
    for (const name of row.items) {
      const k = kind(name);
      if (k !== "game") parts[k] += amount / row.items.length;
    }
  }
  const giftCard = Math.min(parts.giftCard, amount);
  const refunded = Math.min(parts.refunded, amount - giftCard);
  return { game: amount - giftCard - refunded, giftCard, refunded };
}

export type MonthlyPurchaseLine = {
  title: string;
  amount: number;
  date: string;
  /** Purchase date at local midnight, epoch ms; null when `date` is unreadable. */
  purchasedAt: number | null;
  discountPct: number | null;
  /** Estimated pre-discount price for this line when known */
  listAmount: number | null;
};

export type SpendingAnalytics = {
  currency: string;
  grossSpent: number;
  refundedTotal: number;
  netSpent: number;
  /** Everything bought for someone else: gifted games + gift cards. */
  giftSpend: number;
  /** The gift-card part of `giftSpend`. */
  giftCardSpend: number;
  /** Community Market purchases only — sales are in `marketCredits`. */
  marketSpend: number;
  /** Community Market sale proceeds credited to the wallet. */
  marketCredits: number;
  /** Funds added to your own Steam Wallet. */
  walletTopUps: number;
  purchaseCount: number;
  refundCount: number;
  avgPurchase: number;
  medianPurchase: number;
  pctBoughtOnSale: number;
  avgDiscountWhenOnSale: number;
  saleSavings: number;
  monthly: {
    month: string;
    spent: number;
    count: number;
    lines: MonthlyPurchaseLine[];
  }[];
  yearly: { year: string; spent: number; count: number }[];
  paymentMethods: { method: string; spent: number; count: number }[];
  topPurchases: {
    date: string;
    items: string[];
    total: number;
    discountPct: number | null;
  }[];
  biggestPurchases: {
    date: string;
    items: string[];
    total: number;
  }[];
  licenseMix: { method: string; count: number }[];
  valveSpendUsd: {
    totalSpend: number | null;
    packageOnlySpend: number | null;
    packageOnlySavings: number | null;
  };
  habits: string[];
};

function normalizePayment(raw: string): string {
  const t = raw.replace(/\s+/g, " ").trim();
  if (/upi/i.test(t)) return "UPI";
  if (/visa/i.test(t)) return "Visa";
  if (/mastercard|master card/i.test(t)) return "Mastercard";
  if (/wallet/i.test(t)) return "Steam Wallet";
  if (/paypal/i.test(t)) return "PayPal";
  return t || "Unknown";
}

/** "₹ 5 Wallet" — an amount first, then the method. Not "Visa **77". */
const SPLIT_PAYMENT_PART = /^\s*(?:\p{Sc}|[A-Za-z]{0,3}\$)?\s*\d/u;

/**
 * First number in a split-payment part: "₹ 2,176 Visa" → 2176, "5,50 €" → 5.5.
 * Local on purpose: the account-data parsers pull cheerio, and this module is
 * reachable from client components.
 */
function leadingAmount(raw: string): number {
  const token = raw.match(/\d[\d.,]*/)?.[0].replace(/[.,]+$/, "");
  if (!token) return 0;
  // A final separator followed by 1–2 digits is the decimal point
  const dec = token.match(/[.,](\d{1,2})$/);
  const whole = (dec ? token.slice(0, -dec[0].length) : token).replace(/[.,]/g, "");
  return Number(dec ? `${whole}.${dec[1]}` : whole);
}

/**
 * How `amount` was paid. A single method takes it all; a split payment
 * ("₹ 5 Wallet", "₹ 2,176 Visa") is booked to each method in proportion to
 * its part.
 */
function paymentShares(
  paymentMethods: string[],
  amount: number,
): { method: string; spent: number }[] {
  const parts = paymentMethods.map((raw) => ({
    raw,
    amount: SPLIT_PAYMENT_PART.test(raw) ? leadingAmount(raw) : 0,
  }));
  const total = parts.reduce((s, p) => s + p.amount, 0);
  if (parts.length > 1 && total > 0 && parts.every((p) => p.amount > 0)) {
    return parts.map((p) => ({
      // Drop the leading amount so an unrecognised method keeps a clean name
      method: normalizePayment(
        p.raw.replace(/[\d.,]+/, "").replace(/^[^\p{L}]+/u, ""),
      ),
      spent: (amount * p.amount) / total,
    }));
  }
  const raw =
    paymentMethods.find((p) => !SPLIT_PAYMENT_PART.test(p)) ??
    paymentMethods[0] ??
    "Unknown";
  return [{ method: normalizePayment(raw), spent: amount }];
}

/**
 * Pre-discount list price in purchase currency (INR).
 *
 * Trusted sources only:
 * - Single-SKU checkout → receipt `originalPrice` (what Steam showed that day)
 * - Multi-SKU checkout → null here; filled later from Steam INR retail (cc=IN)
 *
 * Never reverse a cart-level discount % onto one line (that produced fake
 * figures like RDR2 “₹2512” from a blended −58% cart).
 */
function listAmountForLine(
  paid: number,
  row: PurchaseHistoryRow,
  lineCount: number,
): number | null {
  const original = row.originalPrice?.amount;
  if (
    lineCount === 1 &&
    original != null &&
    original > 0 &&
    original > paid
  ) {
    return Math.round(original);
  }
  return null;
}

function linesFromPurchase(
  row: PurchaseHistoryRow,
  purchasedAt: number | null,
): MonthlyPurchaseLine[] {
  const out: MonthlyPurchaseLine[] = [];
  if (row.lineItems?.length) {
    const usable = row.lineItems.filter(
      (line) =>
        line.amount != null &&
        line.amount >= 0 &&
        isKeptGameItem(row, line.name),
    );
    for (const line of usable) {
      out.push({
        title: line.name,
        amount: line.amount!,
        date: row.dateText,
        purchasedAt,
        discountPct: row.discountPct,
        listAmount: listAmountForLine(line.amount!, row, usable.length),
      });
    }
    return out;
  }

  const amount = purchaseParts(row).game;
  const usable = row.items.filter((i) => i && isKeptGameItem(row, i));
  if (!usable.length || amount <= 0) return out;
  const share = amount / usable.length;
  for (const title of usable) {
    out.push({
      title,
      amount: share,
      date: row.dateText,
      purchasedAt,
      discountPct: row.discountPct,
      listAmount: listAmountForLine(share, row, usable.length),
    });
  }
  return out;
}

export function buildSpendingAnalytics(
  purchases: PurchaseHistoryRow[],
  licenses: LicenseRow[],
  accountSpend: { type: string; amount: number; currency: string }[],
  /** `now`: the snapshot time, for any year-less date label. Never the clock. */
  opts?: { now?: Date | number | string | null },
): SpendingAnalytics {
  const currency =
    purchases.find((p) => p.total?.currencyHint)?.total?.currencyHint ??
    purchases.find((p) => p.price?.currencyHint)?.price?.currencyHint ??
    "INR";

  let grossSpent = 0;
  let refundedTotal = 0;
  let giftSpend = 0;
  let giftCardSpend = 0;
  let marketSpend = 0;
  let marketCredits = 0;
  let walletTopUps = 0;
  let purchaseCount = 0;
  let refundCount = 0;
  let onSaleCount = 0;
  let discountSum = 0;
  let saleSavings = 0;

  const amounts: number[] = [];
  const monthlyMap = new Map<
    string,
    { spent: number; count: number; lines: MonthlyPurchaseLine[] }
  >();
  const yearlyMap = new Map<string, { spent: number; count: number }>();
  const paymentMap = new Map<string, { spent: number; count: number }>();
  const topPurchases: SpendingAnalytics["topPurchases"] = [];

  for (const row of purchases) {
    const rowTotal = moneyOf(row);
    const blob = row.items.join(" ").toLowerCase();
    const date = parseSteamDate(row.dateText, { now: opts?.now });
    const monthKey = date ? format(date, "yyyy-MM") : "unknown";
    const yearKey = date ? format(date, "yyyy") : "unknown";

    // Gifts to others — tracked separately, never part of library spent
    if (isGiftPurchase(row)) {
      if (!row.refunded && rowTotal > 0) giftSpend += rowTotal;
      continue;
    }

    if (row.refunded) {
      // Only refunds of own library purchases affect net library spend
      if (/purchase/i.test(row.type) || blob === "refund" || row.items.length > 0) {
        refundCount += 1;
        refundedTotal += rowTotal;
      }
      continue;
    }

    if (/steam community market/i.test(blob)) {
      // "₹ 5 Credit" is a sale paid into the wallet, not money spent
      const raw = row.total?.raw ?? row.price?.raw ?? "";
      if (/credit/i.test(raw)) marketCredits += rowTotal;
      else marketSpend += rowTotal;
      continue;
    }

    if (/wallet/i.test(row.type) || blob.includes("wallet credit")) {
      walletTopUps += rowTotal;
      continue;
    }

    // Gift cards are sent to someone else — a gift, not a wallet top-up
    const { game: amount, giftCard, refunded } = purchaseParts(row);
    if (giftCard > 0) {
      giftSpend += giftCard;
      giftCardSpend += giftCard;
    }
    // Partial refund: only the refunded items' amounts leave library spend
    if (refunded > 0) {
      refundCount += 1;
      refundedTotal += refunded;
    }

    // Library spend only
    if (!isTrackableGamePurchase(row) || amount <= 0) continue;

    purchaseCount += 1;
    grossSpent += amount;
    amounts.push(amount);

    const purchaseLines = linesFromPurchase(row, date?.getTime() ?? null);
    const m = monthlyMap.get(monthKey) ?? {
      spent: 0,
      count: 0,
      lines: [],
    };
    m.spent += amount;
    m.count += 1;
    m.lines.push(...purchaseLines);
    monthlyMap.set(monthKey, m);

    const y = yearlyMap.get(yearKey) ?? { spent: 0, count: 0 };
    y.spent += amount;
    y.count += 1;
    yearlyMap.set(yearKey, y);

    // `count` = purchases that used the method (a split payment counts once
    // for each method it used).
    for (const share of paymentShares(row.paymentMethods, amount)) {
      const p = paymentMap.get(share.method) ?? { spent: 0, count: 0 };
      p.spent += share.spent;
      p.count += 1;
      paymentMap.set(share.method, p);
    }

    if (row.discountPct != null && row.discountPct < 0) {
      onSaleCount += 1;
      discountSum += Math.abs(row.discountPct);
      if (row.originalPrice?.amount != null && row.discountedPrice?.amount != null) {
        saleSavings += row.originalPrice.amount - row.discountedPrice.amount;
      }
    }

    topPurchases.push({
      date: row.dateText,
      items: row.items.filter((i) => isKeptGameItem(row, i)),
      total: amount,
      discountPct: row.discountPct,
    });
  }

  const licenseMixMap = new Map<string, number>();
  for (const lic of licenses) {
    const method = lic.acquisitionMethod || "Unknown";
    licenseMixMap.set(method, (licenseMixMap.get(method) ?? 0) + 1);
  }

  const valve = {
    totalSpend:
      accountSpend.find((r) => r.type === "TotalSpend")?.amount ?? null,
    packageOnlySpend:
      accountSpend.find((r) => r.type === "PackageOnlySpend")?.amount ?? null,
    packageOnlySavings:
      accountSpend.find((r) => r.type === "PackageOnlySavings")?.amount ?? null,
  };

  const pctBoughtOnSale =
    purchaseCount > 0 ? (onSaleCount / purchaseCount) * 100 : 0;
  const avgDiscountWhenOnSale = onSaleCount > 0 ? discountSum / onSaleCount : 0;

  const habits: string[] = [];
  if (pctBoughtOnSale >= 50) {
    habits.push(
      `Sale hunter — ${pctBoughtOnSale.toFixed(0)}% of purchases were discounted (avg ${avgDiscountWhenOnSale.toFixed(0)}% off).`,
    );
  } else if (pctBoughtOnSale > 0) {
    habits.push(
      `${pctBoughtOnSale.toFixed(0)}% of purchases were on sale; you still buy full-price fairly often.`,
    );
  }
  if (valve.packageOnlySavings && valve.packageOnlySpend) {
    habits.push(
      `Steam's package ledger shows meaningful sale savings vs what you paid for packages (shown in your spend currency on the dashboard).`,
    );
  }
  const storeLicenses = licenseMixMap.get("Steam Store") ?? 0;
  const complimentary = licenseMixMap.get("Complimentary") ?? 0;
  if (storeLicenses + complimentary > 0) {
    habits.push(
      `Library acquisition: ${storeLicenses} Steam Store licenses vs ${complimentary} complimentary/promos.`,
    );
  }
  if (refundCount > 0) {
    habits.push(
      `${refundCount} refunds totaling ${currency} ${new Intl.NumberFormat("en-US").format(refundedTotal)} (excluded from spend).`,
    );
  }

  const monthly = [...monthlyMap.entries()]
    .filter(([k]) => k !== "unknown")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({
      month,
      spent: v.spent,
      count: v.count,
      lines: [...v.lines].sort((a, b) => b.amount - a.amount),
    }));

  const yearly = [...yearlyMap.entries()]
    .filter(([k]) => k !== "unknown")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([year, v]) => ({ year, ...v }));

  // Refunded purchases are skipped above and never enter grossSpent.
  // Do not subtract refundedTotal again — that understated "You spent".
  const netSpent = grossSpent;

  return {
    currency,
    grossSpent,
    refundedTotal,
    netSpent,
    giftSpend,
    giftCardSpend,
    marketSpend,
    marketCredits,
    walletTopUps,
    purchaseCount,
    refundCount,
    avgPurchase: purchaseCount ? grossSpent / purchaseCount : 0,
    medianPurchase: median(amounts) ?? 0,
    pctBoughtOnSale,
    avgDiscountWhenOnSale,
    saleSavings,
    monthly,
    yearly,
    paymentMethods: [...paymentMap.entries()]
      .map(([method, v]) => ({ method, ...v }))
      .sort((a, b) => b.spent - a.spent),
    topPurchases: [...topPurchases].sort((a, b) => b.total - a.total).slice(0, 12),
    biggestPurchases: [...topPurchases]
      .sort((a, b) => b.total - a.total)
      .slice(0, 8)
      .map(({ date, items, total }) => ({ date, items, total })),
    licenseMix: [...licenseMixMap.entries()]
      .map(([method, count]) => ({ method, count }))
      .sort((a, b) => b.count - a.count),
    valveSpendUsd: valve,
    habits,
  };
}

export function gameTitlesFromPurchases(
  purchases: PurchaseHistoryRow[],
): string[] {
  const titles = new Set<string>();
  for (const row of purchases) {
    if (!isTrackableGamePurchase(row)) continue;
    for (const item of row.items) {
      const t = item.trim();
      if (!t) continue;
      if (!isKeptGameItem(row, t)) continue;
      if (isTemporaryLibraryItem(t)) continue;
      titles.add(t);
    }
  }
  return [...titles];
}

/**
 * Closest related cache key for a purchase line: same title, or one extends
 * the other ("DOOM Eternal Standard Edition" ↔ "doom eternal"). Never a
 * sequel ("Hades" ↔ "hades ii"); the smallest length gap wins.
 */
function closestRetail(t: string, byKey: Map<string, number>): number | undefined {
  const extendsKey = (long: string, short: string) =>
    (long.startsWith(`${short}:`) || long.startsWith(`${short} `)) &&
    !isSequelRemainder(long.slice(short.length));
  let best: { retail: number; gap: number } | null = null;
  for (const [k, retail] of byKey) {
    if (!extendsKey(k, t) && !extendsKey(t, k)) continue;
    const gap = Math.abs(k.length - t.length);
    if (!best || gap < best.gap) best = { retail, gap };
  }
  return best?.retail;
}

/**
 * Fill month-detail list prices from Steam store INR MSRP (cc=IN
 * price_overview.initial). Never USD×FX, never cart-discount math.
 *
 * Overwrites only when we have a real INR retail; keeps single-checkout
 * receipt originals when Steam retail is missing (e.g. packages).
 */
export function applySteamInrListPrices(
  monthly: SpendingAnalytics["monthly"],
  quotes: Record<
    string,
    { title: string; retailInr?: number | null; currentInr?: number | null }
  >,
) {
  const byKey = new Map<string, number>();
  for (const [key, q] of Object.entries(quotes)) {
    if (q.retailInr == null || q.retailInr <= 0) continue;
    byKey.set(normTitle(q.title), q.retailInr);
    byKey.set(normTitle(key), q.retailInr);
  }

  for (const month of monthly) {
    for (const line of month.lines) {
      const t = normTitle(line.title);
      const retail = byKey.get(t) ?? closestRetail(t, byKey);

      if (retail != null && retail > line.amount) {
        line.listAmount = Math.round(retail);
      } else if (line.listAmount != null) {
        line.listAmount = Math.round(line.listAmount);
      }
    }
  }
}

/** Titles that belong in your library for market valuation. */
export function libraryTitlesForValuation(
  purchases: PurchaseHistoryRow[],
  licenses: LicenseRow[],
): string[] {
  const titles = new Set<string>(gameTitlesFromPurchases(purchases));
  for (const lic of licenses) {
    if (!isOwnedLibraryLicense(lic)) continue;
    const t = lic.item.trim();
    if (t) titles.add(t);
  }
  return [...titles];
}

function isPricedGiftTitle(name: string): boolean {
  const t = name.trim();
  if (!t) return false;
  if (isGiftCardName(t)) return false;
  if (/^gift sent to\b/i.test(t)) return false;
  return true;
}

/** Games you bought as gifts for others — not in your library, still need quotes. */
export function giftSentTitlesFromPurchases(
  purchases: PurchaseHistoryRow[],
): string[] {
  const titles = new Set<string>();
  for (const row of purchases) {
    if (!isGiftPurchase(row) || row.refunded) continue;
    const names = row.lineItems?.length
      ? row.lineItems.map((l) => l.name)
      : row.items;
    for (const name of names) {
      if (isPricedGiftTitle(name)) titles.add(name.trim());
    }
  }
  return [...titles];
}

/** Library + sent gifts + owned play + mail gifts — the set that must be priced. */
export function titlesForPriceRefresh(input: {
  purchases: PurchaseHistoryRow[];
  licenses: LicenseRow[];
  ownedTitles?: string[];
  mailGiftTitles?: string[];
}): string[] {
  const titles = new Set<string>(
    libraryTitlesForValuation(input.purchases, input.licenses),
  );
  for (const t of giftSentTitlesFromPurchases(input.purchases)) titles.add(t);
  for (const t of input.ownedTitles ?? []) {
    if (t.trim()) titles.add(t.trim());
  }
  for (const t of input.mailGiftTitles ?? []) {
    if (t.trim()) titles.add(t.trim());
  }
  return [...titles];
}
