import type { StatsInput } from "./types";
import { sum } from "./util";

export type PaidVsLowRow = {
  title: string;
  steamAppId: number | null;
  paid: number;
  lowest: number;
  /** paid − lowest: positive means paid above the all-time low. */
  gap: number;
};

export type PaidVsLowStat = {
  /** Largest gap above the low first, largest gap below last. */
  rows: PaidVsLowRow[];
  atOrBelowCount: number;
  aboveCount: number;
  /** Total paid above the lows (sum of positive gaps). */
  aboveTotal: number;
  /** Total paid below the lows (sum of negative gaps, as a positive number). */
  belowTotal: number;
  /** What the compared titles cost in total. */
  paidTotal: number;
  /** Purchased titles with a price paid but no low on record. */
  noLowCount: number;
};

export function paidVsLow(input: StatsInput): PaidVsLowStat | null {
  const purchased = input.valuation.games.filter(
    (g) => g.kind === "purchased" && g.paid != null && g.paid > 0,
  );
  const rows: PaidVsLowRow[] = [];
  for (const g of purchased) {
    if (g.lowest == null || !(g.lowest > 0)) continue;
    const paid = g.paid as number;
    rows.push({
      title: g.title,
      steamAppId: g.steamAppId,
      paid,
      lowest: g.lowest,
      gap: paid - g.lowest,
    });
  }
  if (!rows.length) return null;
  rows.sort((a, b) => b.gap - a.gap || a.title.localeCompare(b.title));

  return {
    rows,
    atOrBelowCount: rows.filter((r) => r.gap <= 0).length,
    aboveCount: rows.filter((r) => r.gap > 0).length,
    aboveTotal: sum(rows.map((r) => Math.max(r.gap, 0))),
    belowTotal: sum(rows.map((r) => Math.max(-r.gap, 0))),
    paidTotal: sum(rows.map((r) => r.paid)),
    noLowCount: purchased.length - rows.length,
  };
}
