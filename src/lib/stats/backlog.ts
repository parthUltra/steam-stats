import { normTitle } from "@/lib/analytics/acquisition";
import type { StatsInput } from "./types";
import { DAY_MS, PLAYED_HOURS, median, purchaseDateByTitle, sum } from "./util";

export type BacklogRow = {
  title: string;
  steamAppId: number | null;
  paid: number;
  hours: number;
  /** Purchase date when the exact title appears in purchase history. */
  boughtAt: number | null;
  shelfDays: number | null;
};

export type BacklogStat = {
  asOf: number;
  /** Owned games (family-library titles excluded). */
  ownedCount: number;
  /** Owned with exactly zero playtime. */
  neverPlayedCount: number;
  /** Owned with some playtime but under 30 minutes. */
  barelyPlayedCount: number;
  /** Paid titles under 30 minutes of play. */
  paidCount: number;
  paidCost: number;
  /** All paid titles matched to playtime — the denominator for the share. */
  paidTitlesTotal: number;
  paidTotal: number;
  /** paidCost / paidTotal, 0–1. */
  share: number;
  medianShelfDays: number | null;
  /** Most expensive first. */
  rows: BacklogRow[];
};

export function backlog(input: StatsInput): BacklogStat | null {
  const owned = input.playedGames.filter((g) => g.fromFamily !== true);
  const paid = input.costPerHour.games;
  if (!owned.length && !paid.length) return null;

  const boughtAt = purchaseDateByTitle(input.purchases);
  const rows: BacklogRow[] = paid
    .filter((g) => g.hours < PLAYED_HOURS)
    .map((g) => {
      const at = boughtAt.get(normTitle(g.title)) ?? null;
      return {
        title: g.title,
        steamAppId: g.steamAppId,
        paid: g.paid,
        hours: g.hours,
        boughtAt: at,
        shelfDays: at == null ? null : Math.max(0, (input.now - at) / DAY_MS),
      };
    })
    .sort((a, b) => b.paid - a.paid || a.title.localeCompare(b.title));

  const paidCost = sum(rows.map((r) => r.paid));
  const paidTotal = sum(paid.map((g) => g.paid));
  return {
    asOf: input.now,
    ownedCount: owned.length,
    neverPlayedCount: owned.filter((g) => !(g.hoursForever > 0)).length,
    barelyPlayedCount: owned.filter(
      (g) => g.hoursForever > 0 && g.hoursForever < PLAYED_HOURS,
    ).length,
    paidCount: rows.length,
    paidCost,
    paidTitlesTotal: paid.length,
    paidTotal,
    share: paidTotal > 0 ? paidCost / paidTotal : 0,
    medianShelfDays: median(
      rows.flatMap((r) => (r.shelfDays == null ? [] : [r.shelfDays])),
    ),
    rows,
  };
}
