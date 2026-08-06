import { parse, format } from "date-fns";
import type { LicenseRow, PurchaseHistoryRow } from "@/lib/account-data";

export function parseSteamDate(dateText: string): Date | null {
  const cleaned = dateText.trim();
  if (!cleaned) return null;
  const formats = ["d MMM, yyyy", "MMM d, yyyy", "d MMMM, yyyy"];
  for (const f of formats) {
    const d = parse(cleaned, f, new Date());
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

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
  if (blob.includes("gift card")) return false;
  if (blob.includes("steam community market")) return false;
  if (blob === "refund") return false;
  if (blob.includes("wallet credit")) return false;
  return row.items.length > 0;
}

/** Licenses that are temporary / not lasting ownership. */
export function isTemporaryLibraryLicense(license: LicenseRow): boolean {
  const item = license.item.toLowerCase();
  return /free weekend|free on demand|promotional package|limited free|demo\b|playtest|temporary content|\bguest pass\b/.test(
    item,
  );
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

export type SpendingAnalytics = {
  currency: string;
  grossSpent: number;
  refundedTotal: number;
  netSpent: number;
  giftSpend: number;
  marketSpend: number;
  walletTopUps: number;
  purchaseCount: number;
  refundCount: number;
  avgPurchase: number;
  medianPurchase: number;
  pctBoughtOnSale: number;
  avgDiscountWhenOnSale: number;
  saleSavings: number;
  monthly: { month: string; spent: number; count: number }[];
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

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function normalizePayment(raw: string): string {
  const t = raw.replace(/\s+/g, " ").trim();
  if (/upi/i.test(t)) return "UPI";
  if (/visa/i.test(t)) return "Visa";
  if (/mastercard|master card/i.test(t)) return "Mastercard";
  if (/wallet/i.test(t)) return "Steam Wallet";
  if (/paypal/i.test(t)) return "PayPal";
  return t || "Unknown";
}

export function buildSpendingAnalytics(
  purchases: PurchaseHistoryRow[],
  licenses: LicenseRow[],
  accountSpend: { type: string; amount: number; currency: string }[],
): SpendingAnalytics {
  const currency =
    purchases.find((p) => p.total?.currencyHint)?.total?.currencyHint ??
    purchases.find((p) => p.price?.currencyHint)?.price?.currencyHint ??
    "INR";

  let grossSpent = 0;
  let refundedTotal = 0;
  let giftSpend = 0;
  let marketSpend = 0;
  let walletTopUps = 0;
  let purchaseCount = 0;
  let refundCount = 0;
  let onSaleCount = 0;
  let discountSum = 0;
  let saleSavings = 0;

  const amounts: number[] = [];
  const monthlyMap = new Map<string, { spent: number; count: number }>();
  const yearlyMap = new Map<string, { spent: number; count: number }>();
  const paymentMap = new Map<string, { spent: number; count: number }>();
  const topPurchases: SpendingAnalytics["topPurchases"] = [];

  for (const row of purchases) {
    const amount = moneyOf(row);
    const blob = row.items.join(" ").toLowerCase();
    const date = parseSteamDate(row.dateText);
    const monthKey = date ? format(date, "yyyy-MM") : "unknown";
    const yearKey = date ? format(date, "yyyy") : "unknown";

    // Gifts to others — tracked separately, never part of library spent
    if (isGiftPurchase(row)) {
      if (!row.refunded && amount > 0) giftSpend += amount;
      continue;
    }

    if (row.refunded) {
      // Only refunds of own library purchases affect net library spend
      if (/purchase/i.test(row.type) || blob === "refund" || row.items.length > 0) {
        refundCount += 1;
        refundedTotal += amount;
      }
      continue;
    }

    if (/steam community market/i.test(blob)) {
      marketSpend += amount;
      continue;
    }

    if (/gift card/i.test(blob) || /wallet/i.test(row.type)) {
      walletTopUps += amount;
      continue;
    }

    // Library spend only
    if (!isTrackableGamePurchase(row) || amount <= 0) continue;

    purchaseCount += 1;
    grossSpent += amount;
    amounts.push(amount);

    const m = monthlyMap.get(monthKey) ?? { spent: 0, count: 0 };
    m.spent += amount;
    m.count += 1;
    monthlyMap.set(monthKey, m);

    const y = yearlyMap.get(yearKey) ?? { spent: 0, count: 0 };
    y.spent += amount;
    y.count += 1;
    yearlyMap.set(yearKey, y);

    const payRaw =
      row.paymentMethods.find((p) => !/^\u20b9|^₹|^\d/.test(p)) ??
      row.paymentMethods[0] ??
      "Unknown";
    const method = normalizePayment(payRaw);
    const p = paymentMap.get(method) ?? { spent: 0, count: 0 };
    p.spent += amount;
    p.count += 1;
    paymentMap.set(method, p);

    if (row.discountPct != null && row.discountPct < 0) {
      onSaleCount += 1;
      discountSum += Math.abs(row.discountPct);
      if (row.originalPrice?.amount != null && row.discountedPrice?.amount != null) {
        saleSavings += row.originalPrice.amount - row.discountedPrice.amount;
      }
    }

    topPurchases.push({
      date: row.dateText,
      items: row.items,
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
  if (giftSpend > 0) {
    habits.push(
      `Gifts you sent: ${currency} ${giftSpend.toLocaleString()} (separate from library spend & shelf value).`,
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
      `${refundCount} refunds totaling ${currency} ${refundedTotal.toLocaleString()}.`,
    );
  }

  const monthly = [...monthlyMap.entries()]
    .filter(([k]) => k !== "unknown")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({ month, ...v }));

  const yearly = [...yearlyMap.entries()]
    .filter(([k]) => k !== "unknown")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([year, v]) => ({ year, ...v }));

  return {
    currency,
    grossSpent,
    refundedTotal,
    netSpent: grossSpent - refundedTotal,
    giftSpend,
    marketSpend,
    walletTopUps,
    purchaseCount,
    refundCount,
    avgPurchase: purchaseCount ? grossSpent / purchaseCount : 0,
    medianPurchase: median(amounts),
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
      titles.add(t);
    }
  }
  return [...titles];
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
