import type {
  LicenseRow,
  PlayedGame,
  PurchaseHistoryRow,
} from "@/lib/account-data";
import type { CostPerHourGame } from "@/lib/analytics/cost-per-hour";
import type { SpendingAnalytics } from "@/lib/analytics/spending";
import type { ValuationGame } from "@/lib/analytics/valuation";
import type { StatsInput } from "./types";

/** Snapshot time used by tests: 1 Jul 2026, local noon. */
export const NOW = new Date(2026, 6, 1, 12).getTime();

export function daysAgo(days: number): number {
  return NOW - days * 86_400_000;
}

let nextId = 1;

export function game(
  name: string,
  hours: number,
  extra: Partial<PlayedGame> = {},
): PlayedGame {
  return {
    appId: nextId++,
    name,
    hoursForever: hours,
    hours2Weeks: null,
    lastPlayedText: null,
    lastPlayedAt: null,
    minutesForever: Math.round(hours * 60),
    fromFamily: false,
    ...extra,
  };
}

const inr = (amount: number) => ({
  raw: `₹ ${amount}`,
  amount,
  currencyHint: "INR",
});

export function purchase(
  dateText: string,
  items: string[],
  total: number,
  extra: Partial<PurchaseHistoryRow> = {},
): PurchaseHistoryRow {
  return {
    dateText,
    items,
    lineItems: [],
    type: "Purchase",
    paymentMethods: ["Visa"],
    isGift: false,
    giftRecipient: null,
    price: inr(total),
    originalPrice: null,
    discountedPrice: null,
    discountPct: null,
    tax: null,
    shipping: null,
    total: inr(total),
    walletChange: null,
    walletBalance: null,
    transactionId: null,
    refunded: false,
    isWalletBalanceChange: false,
    ...extra,
  };
}

/** A discounted purchase: list price `original`, paid `total`. */
export function discounted(
  dateText: string,
  items: string[],
  original: number,
  total: number,
): PurchaseHistoryRow {
  return purchase(dateText, items, total, {
    originalPrice: inr(original),
    discountedPrice: inr(total),
    discountPct: -Math.round((1 - total / original) * 100),
  });
}

export function paidGame(
  title: string,
  paid: number,
  hours: number,
  steamAppId: number | null = null,
): CostPerHourGame {
  return {
    title,
    steamAppId,
    paid,
    hours,
    costPerHour: hours >= 0.5 ? paid / Math.max(hours, 1) : null,
    current: null,
    isGift: false,
  };
}

export function shelfGame(
  title: string,
  extra: Partial<ValuationGame> = {},
): ValuationGame {
  return {
    title,
    paid: null,
    current: null,
    lowest: null,
    steamAppId: null,
    onSale: false,
    resolved: true,
    kind: "purchased",
    isGift: false,
    isUnpaidShelf: false,
    ...extra,
  };
}

export function monthly(
  rows: [month: string, spent: number, count: number][],
): SpendingAnalytics["monthly"] {
  return rows.map(([month, spent, count]) => ({
    month,
    spent,
    count,
    lines: [],
  }));
}

/**
 * A StatsInput with empty defaults. Only the fields the stats read are filled;
 * the analytics objects are otherwise left bare on purpose.
 */
export function makeInput(over: {
  playedGames?: PlayedGame[];
  purchases?: PurchaseHistoryRow[];
  licenses?: LicenseRow[];
  monthly?: SpendingAnalytics["monthly"];
  valuationGames?: ValuationGame[];
  paidGames?: CostPerHourGame[];
  now?: number;
} = {}): StatsInput {
  const paidGames = over.paidGames ?? [];
  return {
    playedGames: over.playedGames ?? [],
    purchases: over.purchases ?? [],
    licenses: over.licenses ?? [],
    spending: {
      currency: "INR",
      monthly: over.monthly ?? [],
    } as unknown as StatsInput["spending"],
    valuation: {
      currency: "INR",
      games: over.valuationGames ?? [],
    } as unknown as StatsInput["valuation"],
    costPerHour: {
      currency: "INR",
      games: paidGames,
      playedPaid: paidGames.filter((g) => g.costPerHour != null),
      unplayedPaid: paidGames.filter((g) => g.costPerHour == null),
    } as unknown as StatsInput["costPerHour"],
    currency: "INR",
    now: over.now ?? NOW,
  };
}
