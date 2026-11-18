import type { StatsInput } from "./types";
import { PLAYED_HOURS, median, sum } from "./util";

export type ValueMapPoint = {
  title: string;
  steamAppId: number | null;
  paid: number;
  hours: number;
  /** Cost per hour as the rest of the app reports it (under 1 h counts as 1 h). */
  rate: number;
};

export type ValueMapUnplayed = {
  title: string;
  steamAppId: number | null;
  paid: number;
  hours: number;
};

export type ValueMapStat = {
  /** Paid titles with 30+ minutes played — the plotted points. */
  points: ValueMapPoint[];
  /** Paid titles under 30 minutes — cannot sit on a log hours axis. */
  unplayed: ValueMapUnplayed[];
  medianPaid: number;
  /** Median hours of the plotted points; null when nothing is plotted. */
  medianHours: number | null;
  /** Paid at or above the median, under 2 hours played; priciest first. */
  regrets: ValueMapUnplayed[];
  /** 10+ hours played, cheapest per hour first. */
  steals: ValueMapPoint[];
  /** Lifetime hours on the titles shown vs every game in the library. */
  hoursCovered: number;
  totalHours: number;
};

const REGRET_MAX_HOURS = 2;
const STEAL_MIN_HOURS = 10;
const LIST_LIMIT = 5;

export function valueMap(input: StatsInput): ValueMapStat | null {
  const games = input.costPerHour.games.filter((g) => g.paid > 0);
  if (!games.length) return null;

  const points: ValueMapPoint[] = [];
  const unplayed: ValueMapUnplayed[] = [];
  for (const g of games) {
    if (g.hours >= PLAYED_HOURS) {
      points.push({
        title: g.title,
        steamAppId: g.steamAppId,
        paid: g.paid,
        hours: g.hours,
        rate: g.costPerHour ?? g.paid / Math.max(g.hours, 1),
      });
    } else {
      unplayed.push({
        title: g.title,
        steamAppId: g.steamAppId,
        paid: g.paid,
        hours: g.hours,
      });
    }
  }
  unplayed.sort((a, b) => b.paid - a.paid || a.title.localeCompare(b.title));

  const medianPaid = median(games.map((g) => g.paid)) ?? 0;
  const regrets = games
    .filter((g) => g.paid >= medianPaid && g.hours < REGRET_MAX_HOURS)
    .sort((a, b) => b.paid - a.paid || a.title.localeCompare(b.title))
    .slice(0, LIST_LIMIT)
    .map((g) => ({
      title: g.title,
      steamAppId: g.steamAppId,
      paid: g.paid,
      hours: g.hours,
    }));
  const steals = points
    .filter((p) => p.hours >= STEAL_MIN_HOURS)
    .sort((a, b) => a.rate - b.rate || a.title.localeCompare(b.title))
    .slice(0, LIST_LIMIT);

  return {
    points,
    unplayed,
    medianPaid,
    medianHours: median(points.map((p) => p.hours)),
    regrets,
    steals,
    hoursCovered: sum(games.map((g) => g.hours)),
    totalHours: sum(input.playedGames.map((g) => Math.max(g.hoursForever, 0))),
  };
}
