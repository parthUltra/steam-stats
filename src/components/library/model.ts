import type { DashboardPayload } from "@/lib/analytics/contracts";

export type Game = DashboardPayload["playtime"]["games"][number];

export type LibrarySort = "hours" | "recent" | "name";
export type LibraryLayout = "grid" | "list" | "panorama";
export type PlayedFilter = "all" | "played" | "unplayed";

export type LibraryFilters = {
  played: PlayedFilter;
  family: boolean;
  recent: boolean;
};

/** What the Value payload knows about one shelf title. */
export type GameValue = {
  paid: number | null;
  current: number | null;
  lowest: number | null;
  costPerHour: number | null;
  onSale: boolean;
  note: string | null;
};

export type ShelfRow = {
  game: Game;
  /** 1-based rank by lifetime hours across the whole library. */
  rank: number;
  value: GameValue | null;
};

export const isUnplayed = (g: Game) => g.hoursForever <= 0;
export const isRecent = (g: Game) => (g.hours2Weeks ?? 0) > 0;

/** appId → money facts, joined from valuation and cost-per-hour rows. */
export function buildValueIndex(
  data: Pick<DashboardPayload, "valuation" | "costPerHour">,
): Map<number, GameValue> {
  const map = new Map<number, GameValue>();
  const { valuation, costPerHour } = data;
  const lists = [
    valuation.games,
    valuation.giftsReceivedGames,
    valuation.bundleGames,
    valuation.freeGames,
    valuation.ownershipGrantGames,
    valuation.unknownUnpaidGames,
  ];
  for (const list of lists) {
    for (const v of list ?? []) {
      if (v.steamAppId == null || map.has(v.steamAppId)) continue;
      map.set(v.steamAppId, {
        paid: v.paid,
        current: v.current,
        lowest: v.lowest,
        costPerHour: null,
        onSale: v.onSale,
        note: v.acquisitionNote ?? null,
      });
    }
  }
  for (const c of [...costPerHour.playedPaid, ...costPerHour.unplayedPaid]) {
    if (c.steamAppId == null) continue;
    const prev = map.get(c.steamAppId);
    if (prev) {
      prev.costPerHour = c.costPerHour;
      if (prev.paid == null) prev.paid = c.paid;
    } else {
      map.set(c.steamAppId, {
        paid: c.paid,
        current: c.current,
        lowest: null,
        costPerHour: c.costPerHour,
        onSale: false,
        note: null,
      });
    }
  }
  return map;
}

export function buildRows(
  games: Game[],
  values: Map<number, GameValue>,
): ShelfRow[] {
  return [...games]
    .sort((a, b) => b.hoursForever - a.hoursForever)
    .map((game, i) => ({
      game,
      rank: i + 1,
      value: values.get(game.appId) ?? null,
    }));
}

export function sortRows(rows: ShelfRow[], sort: LibrarySort): ShelfRow[] {
  const list = [...rows];
  if (sort === "name") {
    list.sort((a, b) => a.game.name.localeCompare(b.game.name, "en"));
  } else if (sort === "recent") {
    list.sort((a, b) => {
      const aAt = a.game.lastPlayedAt ?? 0;
      const bAt = b.game.lastPlayedAt ?? 0;
      if (bAt !== aAt) return bAt - aAt;
      const a2 = a.game.hours2Weeks ?? 0;
      const b2 = b.game.hours2Weeks ?? 0;
      if (b2 !== a2) return b2 - a2;
      const aAdd = a.game.addedAt ?? 0;
      const bAdd = b.game.addedAt ?? 0;
      if (bAdd !== aAdd) return bAdd - aAdd;
      return a.rank - b.rank;
    });
  }
  // "hours": rows are already in rank order.
  return list;
}

/** Lower-case, without ™/®/© or punctuation, single-spaced. */
export function searchKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[™®©]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function filterRows(
  rows: ShelfRow[],
  query: string,
  filters: LibraryFilters,
): ShelfRow[] {
  const q = searchKey(query);
  return rows.filter(({ game }) => {
    if (q && !searchKey(game.name).includes(q)) return false;
    if (filters.played === "played" && isUnplayed(game)) return false;
    if (filters.played === "unplayed" && !isUnplayed(game)) return false;
    if (filters.family && !game.fromFamily) return false;
    if (filters.recent && !isRecent(game)) return false;
    return true;
  });
}
