import type { StatsInput } from "./types";

export type GridCell = { spent: number; count: number };

export type PurchaseGridStat = {
  /** Oldest year first; years with no purchases in between are included. */
  years: string[];
  /** cells[yearIndex][monthIndex 0–11] */
  cells: GridCell[][];
  /** Spend per calendar month across all years, index 0 = January. */
  monthTotals: number[];
  yearTotals: number[];
  total: number;
  /** Largest single cell, used to scale the fill. */
  maxCell: number;
  /** The two heaviest calendar months and their combined share of spend. */
  topMonths: { monthIndexes: number[]; share: number };
  purchaseCount: number;
};

const MONTH_RE = /^(\d{4})-(\d{2})$/;

export function purchaseGrid(input: StatsInput): PurchaseGridStat | null {
  const parsed = input.spending.monthly.flatMap((m) => {
    const hit = MONTH_RE.exec(m.month);
    if (!hit || !(m.spent > 0)) return [];
    const monthIndex = Number(hit[2]) - 1;
    if (monthIndex < 0 || monthIndex > 11) return [];
    return [{ year: Number(hit[1]), monthIndex, spent: m.spent, count: m.count }];
  });
  if (!parsed.length) return null;

  const firstYear = Math.min(...parsed.map((p) => p.year));
  const lastYear = Math.max(...parsed.map((p) => p.year));
  const years: string[] = [];
  for (let y = firstYear; y <= lastYear; y += 1) years.push(String(y));

  const cells: GridCell[][] = years.map(() =>
    Array.from({ length: 12 }, () => ({ spent: 0, count: 0 })),
  );
  const monthTotals = Array.from({ length: 12 }, () => 0);
  const yearTotals = years.map(() => 0);
  let total = 0;
  let purchaseCount = 0;
  for (const p of parsed) {
    const yi = p.year - firstYear;
    cells[yi][p.monthIndex].spent += p.spent;
    cells[yi][p.monthIndex].count += p.count;
    monthTotals[p.monthIndex] += p.spent;
    yearTotals[yi] += p.spent;
    total += p.spent;
    purchaseCount += p.count;
  }

  const ranked = monthTotals
    .map((spent, monthIndex) => ({ spent, monthIndex }))
    .filter((m) => m.spent > 0)
    .sort((a, b) => b.spent - a.spent || a.monthIndex - b.monthIndex)
    .slice(0, 2);

  return {
    years,
    cells,
    monthTotals,
    yearTotals,
    total,
    maxCell: Math.max(...cells.flat().map((c) => c.spent)),
    topMonths: {
      monthIndexes: ranked.map((m) => m.monthIndex).sort((a, b) => a - b),
      share: ranked.reduce((s, m) => s + m.spent, 0) / total,
    },
    purchaseCount,
  };
}
