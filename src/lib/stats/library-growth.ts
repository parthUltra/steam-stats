import { parseSteamDate } from "@/lib/dates";
import { normTitle } from "@/lib/titles";
import type { StatsInput } from "./types";
import { monthKey, monthRange, purchaseDateByTitle } from "./util";

export type GrowthPoint = {
  /** "YYYY-MM" */
  month: string;
  added: number;
  /** Dated games acquired up to and including this month. */
  total: number;
};

export type LibraryGrowthStat = {
  /** Owned games (family-library titles excluded). */
  ownedCount: number;
  /** Owned games with a known acquisition date. */
  datedCount: number;
  /** datedCount / ownedCount, 0–1. */
  coverage: number;
  /** False when under three quarters of the library is dated — a curve would mislead. */
  chartable: boolean;
  /** Gap-filled months from the first dated acquisition to the snapshot. */
  points: GrowthPoint[];
  busiestMonth: { month: string; added: number } | null;
};

const MIN_COVERAGE = 0.75;

export function libraryGrowth(input: StatsInput): LibraryGrowthStat | null {
  const owned = input.playedGames.filter((g) => g.fromFamily !== true);
  if (!owned.length) return null;

  const bought = purchaseDateByTitle(input.purchases);
  const licensed = new Map<string, number>();
  for (const lic of input.licenses) {
    const at = parseSteamDate(lic.dateText, { now: input.now })?.getTime();
    const key = normTitle(lic.item);
    if (at == null || !key) continue;
    const prev = licensed.get(key);
    if (prev == null || at < prev) licensed.set(key, at);
  }

  const gifted = new Map<string, number>();
  for (const gift of input.receivedGifts ?? []) {
    const key = normTitle(gift.title);
    if (gift.receivedAt == null || !(gift.receivedAt > 0) || !key) continue;
    const prev = gifted.get(key);
    if (prev == null || gift.receivedAt < prev) gifted.set(key, gift.receivedAt);
  }

  const dates: number[] = [];
  for (const g of owned) {
    const key = normTitle(g.name);
    const candidates = [
      bought.get(key),
      licensed.get(key),
      gifted.get(key),
      g.addedAt != null && g.addedAt > 0 ? g.addedAt : undefined,
    ].filter((v): v is number => v != null);
    if (candidates.length) dates.push(Math.min(...candidates));
  }
  if (!dates.length) return null;

  const perMonth = new Map<string, number>();
  for (const at of dates) {
    const key = monthKey(at);
    perMonth.set(key, (perMonth.get(key) ?? 0) + 1);
  }
  const first = [...perMonth.keys()].sort()[0];
  const lastDated = [...perMonth.keys()].sort().at(-1)!;
  const snapshot = input.now > 0 ? monthKey(input.now) : lastDated;
  const last = snapshot > lastDated ? snapshot : lastDated;

  let total = 0;
  let busiest: { month: string; added: number } | null = null;
  const points = monthRange(first, last).map((month) => {
    const added = perMonth.get(month) ?? 0;
    total += added;
    if (added > 0 && (!busiest || added > busiest.added)) {
      busiest = { month, added };
    }
    return { month, added, total };
  });

  const coverage = dates.length / owned.length;
  return {
    ownedCount: owned.length,
    datedCount: dates.length,
    coverage,
    chartable: coverage >= MIN_COVERAGE,
    points,
    busiestMonth: busiest,
  };
}
