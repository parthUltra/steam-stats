import type { StatsInput } from "./types";
import { monthKey, monthRange } from "./util";

export type SpendPoint = {
  /** "YYYY-MM" */
  month: string;
  spent: number;
  count: number;
  /** Running total up to and including this month. */
  cumulative: number;
};

export type CumulativeSpendStat = {
  /** Every month from the first purchase to the snapshot, quiet ones included. */
  points: SpendPoint[];
  total: number;
  purchaseCount: number;
  activeMonths: number;
  quietMonths: number;
  years: { year: string; spent: number; count: number; share: number }[];
  topYear: { year: string; spent: number; share: number };
  topMonth: { month: string; spent: number; share: number };
};

const MONTH_RE = /^\d{4}-\d{2}$/;

export function cumulativeSpend(input: StatsInput): CumulativeSpendStat | null {
  const months = input.spending.monthly.filter(
    (m) => MONTH_RE.test(m.month) && m.spent > 0,
  );
  if (!months.length) return null;

  const byMonth = new Map(months.map((m) => [m.month, m]));
  const keys = [...byMonth.keys()].sort();
  const first = keys[0];
  const lastSpend = keys.at(-1)!;
  const snapshot = input.now > 0 ? monthKey(input.now) : lastSpend;
  const last = snapshot > lastSpend ? snapshot : lastSpend;

  let cumulative = 0;
  const points: SpendPoint[] = monthRange(first, last).map((month) => {
    const row = byMonth.get(month);
    cumulative += row?.spent ?? 0;
    return {
      month,
      spent: row?.spent ?? 0,
      count: row?.count ?? 0,
      cumulative,
    };
  });
  const total = cumulative;

  const yearMap = new Map<string, { spent: number; count: number }>();
  for (const m of months) {
    const year = m.month.slice(0, 4);
    const y = yearMap.get(year) ?? { spent: 0, count: 0 };
    y.spent += m.spent;
    y.count += m.count;
    yearMap.set(year, y);
  }
  const years = [...yearMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([year, v]) => ({ year, ...v, share: v.spent / total }));
  const topYear = years.reduce((best, y) => (y.spent > best.spent ? y : best));
  const topMonth = months.reduce((best, m) => (m.spent > best.spent ? m : best));

  return {
    points,
    total,
    purchaseCount: months.reduce((n, m) => n + m.count, 0),
    activeMonths: months.length,
    quietMonths: points.length - months.length,
    years,
    topYear: { year: topYear.year, spent: topYear.spent, share: topYear.share },
    topMonth: {
      month: topMonth.month,
      spent: topMonth.spent,
      share: topMonth.spent / total,
    },
  };
}
