import type { StatsInput } from "./types";
import { sum } from "./util";

export type ConcentrationRow = {
  appId: number;
  name: string;
  hours: number;
  /** Share of all played hours, 0–1. */
  share: number;
  /** Running share up to and including this game, 0–1. */
  cumShare: number;
  fromFamily: boolean;
};

export type ConcentrationStat = {
  totalHours: number;
  playedCount: number;
  top: ConcentrationRow[];
  otherCount: number;
  otherHours: number;
  /** Fewest games whose hours reach half / 80% of all playtime. */
  gamesForHalf: number;
  gamesFor80: number;
};

const TOP_N = 10;

export function concentration(input: StatsInput): ConcentrationStat | null {
  const played = input.playedGames
    .filter((g) => g.hoursForever > 0)
    .sort(
      (a, b) => b.hoursForever - a.hoursForever || a.name.localeCompare(b.name),
    );
  const totalHours = sum(played.map((g) => g.hoursForever));
  if (!played.length || totalHours <= 0) return null;

  let running = 0;
  let gamesForHalf = played.length;
  let gamesFor80 = played.length;
  let halfFound = false;
  let eightyFound = false;
  const rows: ConcentrationRow[] = played.map((g, i) => {
    running += g.hoursForever;
    const cumShare = running / totalHours;
    // Tolerance keeps exact halves (e.g. 50 of 100) from missing on float error.
    if (!halfFound && cumShare >= 0.5 - 1e-9) {
      gamesForHalf = i + 1;
      halfFound = true;
    }
    if (!eightyFound && cumShare >= 0.8 - 1e-9) {
      gamesFor80 = i + 1;
      eightyFound = true;
    }
    return {
      appId: g.appId,
      name: g.name,
      hours: g.hoursForever,
      share: g.hoursForever / totalHours,
      cumShare,
      fromFamily: g.fromFamily === true,
    };
  });

  const top = rows.slice(0, TOP_N);
  const rest = rows.slice(TOP_N);
  return {
    totalHours,
    playedCount: played.length,
    top,
    otherCount: rest.length,
    otherHours: sum(rest.map((r) => r.hours)),
    gamesForHalf,
    gamesFor80,
  };
}
