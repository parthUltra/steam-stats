import { normTitle } from "@/lib/analytics/acquisition";
import type { ValuationGame } from "@/lib/analytics/valuation";
import type { StatsInput } from "./types";
import { sum } from "./util";

export type HoursSource =
  | "purchased"
  | "bundle"
  | "gifted_to_me"
  | "free"
  | "other_owned"
  | "family"
  | "unattributed";

export type HoursSourceRow = {
  source: HoursSource;
  titles: number;
  /** Titles with any playtime. */
  played: number;
  hours: number;
  /** Share of all hours, 0–1. */
  share: number;
};

export type HoursBySourceStat = {
  totalHours: number;
  /** Largest first; sources with no titles are omitted. */
  rows: HoursSourceRow[];
  /** Share of hours on owned games with no purchase, gift or licence record. */
  unattributedShare: number;
  /** Share of hours on owned games whose shelf row has no purchase behind it. */
  otherOwnedShare: number;
  /**
   * Share of hours with no known way of arriving: `unattributed` plus
   * `other_owned`. Both swell when the licence list is incomplete, so this is
   * the figure that says how far the split can be trusted.
   */
  unexplainedShare: number;
};

function sourceOf(kind: ValuationGame["kind"]): HoursSource | null {
  switch (kind) {
    case "purchased":
    case "bundle":
    case "gifted_to_me":
    case "free":
      return kind;
    case "ownership_grant":
    case "unknown_unpaid":
      return "other_owned";
    default:
      // gifted_by_me: not in this library
      return null;
  }
}

export function hoursBySource(input: StatsInput): HoursBySourceStat | null {
  const totalHours = sum(input.playedGames.map((g) => Math.max(g.hoursForever, 0)));
  if (!input.playedGames.length || totalHours <= 0) return null;

  const byAppId = new Map<number, HoursSource>();
  const byTitle = new Map<string, HoursSource>();
  for (const v of input.valuation.games) {
    const source = sourceOf(v.kind);
    if (!source) continue;
    if (v.steamAppId != null && !byAppId.has(v.steamAppId)) {
      byAppId.set(v.steamAppId, source);
    }
    const key = normTitle(v.title);
    if (key && !byTitle.has(key)) byTitle.set(key, source);
  }

  const groups = new Map<HoursSource, HoursSourceRow>();
  for (const g of input.playedGames) {
    const source: HoursSource =
      g.fromFamily === true
        ? "family"
        : (byAppId.get(g.appId) ??
          byTitle.get(normTitle(g.name)) ??
          "unattributed");
    const row = groups.get(source) ?? {
      source,
      titles: 0,
      played: 0,
      hours: 0,
      share: 0,
    };
    row.titles += 1;
    if (g.hoursForever > 0) {
      row.played += 1;
      row.hours += g.hoursForever;
    }
    groups.set(source, row);
  }

  const rows = [...groups.values()]
    .map((r) => ({ ...r, share: r.hours / totalHours }))
    .sort((a, b) => b.hours - a.hours || a.source.localeCompare(b.source));
  const of = (source: HoursSource) => rows.find((r) => r.source === source);
  return {
    totalHours,
    rows,
    unattributedShare: of("unattributed")?.share ?? 0,
    otherOwnedShare: of("other_owned")?.share ?? 0,
    unexplainedShare:
      ((of("unattributed")?.hours ?? 0) + (of("other_owned")?.hours ?? 0)) /
      totalHours,
  };
}
