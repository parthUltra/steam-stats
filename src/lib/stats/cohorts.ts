import { normTitle } from "@/lib/analytics/acquisition";
import type { StatsInput } from "./types";
import { PLAYED_HOURS, purchaseDateByTitle } from "./util";

export type CohortRow = {
  year: string;
  titles: number;
  paid: number;
  /** Titles with 30+ minutes played. */
  played: number;
  /** played / titles, 0–1. */
  playedShare: number;
  /** Lifetime hours on the played titles — not hours played in that year. */
  hours: number;
  /** Paid for titles still under 30 minutes. */
  unplayedPaid: number;
};

export type CohortsStat = {
  /** Oldest year first. */
  rows: CohortRow[];
  /** Paid titles whose exact name is not in purchase history (no date). */
  undatedTitles: number;
  undatedPaid: number;
};

export function cohorts(input: StatsInput): CohortsStat | null {
  const boughtAt = purchaseDateByTitle(input.purchases);
  const byYear = new Map<string, CohortRow>();
  let undatedTitles = 0;
  let undatedPaid = 0;

  for (const g of input.costPerHour.games) {
    if (!(g.paid > 0)) continue;
    const at = boughtAt.get(normTitle(g.title));
    if (at == null) {
      undatedTitles += 1;
      undatedPaid += g.paid;
      continue;
    }
    const year = String(new Date(at).getFullYear());
    const row = byYear.get(year) ?? {
      year,
      titles: 0,
      paid: 0,
      played: 0,
      playedShare: 0,
      hours: 0,
      unplayedPaid: 0,
    };
    row.titles += 1;
    row.paid += g.paid;
    if (g.hours >= PLAYED_HOURS) {
      row.played += 1;
      row.hours += g.hours;
    } else {
      row.unplayedPaid += g.paid;
    }
    byYear.set(year, row);
  }
  if (!byYear.size) return null;

  const rows = [...byYear.values()]
    .sort((a, b) => a.year.localeCompare(b.year))
    .map((r) => ({ ...r, playedShare: r.played / r.titles }));
  return { rows, undatedTitles, undatedPaid };
}
