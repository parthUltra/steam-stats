import type { StatsInput } from "./types";
import { median, sum } from "./util";

export type DistributionBin = {
  /** Stable id, e.g. "0", "lt1", "1-5". */
  id: string;
  /** Lower bound in hours (inclusive, except the "lt1" bin which excludes 0). */
  min: number;
  /** Upper bound in hours (exclusive); null for the open-ended last bin. */
  max: number | null;
  count: number;
  hours: number;
  /** Share of all hours held by games in this bin, 0–1. */
  hoursShare: number;
};

export type DistributionStat = {
  gameCount: number;
  totalHours: number;
  /** Median hours among games with any playtime; null when none are played. */
  medianPlayedHours: number | null;
  bins: DistributionBin[];
};

/** Unequal, roughly logarithmic bins — the chart must label the real ranges. */
const EDGES: [id: string, min: number, max: number | null][] = [
  ["0", 0, 0],
  ["lt1", 0, 1],
  ["1-5", 1, 5],
  ["5-10", 5, 10],
  ["10-25", 10, 25],
  ["25-50", 25, 50],
  ["50-100", 50, 100],
  ["100-250", 100, 250],
  ["250+", 250, null],
];

function binIndex(hours: number): number {
  if (!(hours > 0)) return 0;
  for (let i = 1; i < EDGES.length; i += 1) {
    const max = EDGES[i][2];
    if (max == null || hours < max) return i;
  }
  return EDGES.length - 1;
}

export function distribution(input: StatsInput): DistributionStat | null {
  const games = input.playedGames;
  if (!games.length) return null;
  const totalHours = sum(games.map((g) => Math.max(g.hoursForever, 0)));
  const bins: DistributionBin[] = EDGES.map(([id, min, max]) => ({
    id,
    min,
    max,
    count: 0,
    hours: 0,
    hoursShare: 0,
  }));
  for (const g of games) {
    const bin = bins[binIndex(g.hoursForever)];
    bin.count += 1;
    bin.hours += Math.max(g.hoursForever, 0);
  }
  for (const bin of bins) {
    bin.hoursShare = totalHours > 0 ? bin.hours / totalHours : 0;
  }
  return {
    gameCount: games.length,
    totalHours,
    medianPlayedHours: median(
      games.filter((g) => g.hoursForever > 0).map((g) => g.hoursForever),
    ),
    bins,
  };
}
