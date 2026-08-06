import type { PlayedGame } from "@/lib/account-data";
import type { ValuationGame } from "@/lib/analytics/valuation";
import {
  isBundleTitle,
  stripEditionSuffix,
} from "@/lib/analytics/edition-packs";
import {
  resolveSteamAppId,
  sourcesFromPlaytime,
  sourcesFromValuation,
} from "@/lib/steam/resolve-app-id";

/** Below this, playtime is too noisy for ₹/hr — treat as unplayed. */
export const MIN_PLAYED_HOURS_FOR_RATE = 0.5; // 30 minutes

export type CostPerHourGame = {
  title: string;
  steamAppId: number | null;
  paid: number;
  hours: number;
  /** null when hours < 30m (unplayed / barely touched) */
  costPerHour: number | null;
  current: number | null;
  isGift: boolean;
};

export type CostPerHourAnalytics = {
  currency: string;
  games: CostPerHourGame[];
  playedPaid: CostPerHourGame[];
  unplayedPaid: CostPerHourGame[];
  blendedCostPerHour: number | null;
  totalPaidMatched: number;
  totalHoursMatched: number;
  bestValue: CostPerHourGame | null;
  worstValue: CostPerHourGame | null;
  biggestUnplayed: CostPerHourGame | null;
  matchedCount: number;
  note: string;
};

function norm(title: string) {
  return title
    .toLowerCase()
    .replace(/™|®/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function matchPlaytime(
  game: ValuationGame,
  byAppId: Map<number, PlayedGame>,
  byName: Map<string, PlayedGame>,
  playtimeGames: PlayedGame[],
): PlayedGame | null {
  if (game.steamAppId != null) {
    const hit = byAppId.get(game.steamAppId);
    if (hit) return hit;
  }
  const key = norm(game.title);
  const exact = byName.get(key);
  if (exact) return exact;

  const baseKey = stripEditionSuffix(game.title);
  if (baseKey) {
    const base = byName.get(baseKey);
    if (base) return base;
  }

  const resolvedId = resolveSteamAppId(game.title, [
    ...sourcesFromPlaytime(playtimeGames),
  ]);
  if (resolvedId != null) {
    const hit = byAppId.get(resolvedId);
    if (hit) return hit;
  }

  let best: PlayedGame | null = null;
  for (const p of playtimeGames) {
    const t = norm(p.name);
    if (t.length < 3) continue;
    if (
      key.startsWith(`${t}:`) ||
      key.startsWith(`${t} -`) ||
      key.startsWith(`${t} `) ||
      (baseKey &&
        (baseKey === t ||
          baseKey.startsWith(`${t}:`) ||
          baseKey.startsWith(`${t} `)))
    ) {
      if (!best || t.length > norm(best.name).length) best = p;
    }
  }
  return best;
}

export function buildCostPerHourAnalytics(
  valuationGames: ValuationGame[],
  playtimeGames: PlayedGame[],
  currency: string,
  opts?: { includeGifts?: boolean },
): CostPerHourAnalytics {
  const includeGifts = Boolean(opts?.includeGifts);
  const byAppId = new Map(playtimeGames.map((g) => [g.appId, g]));
  const byName = new Map(playtimeGames.map((g) => [norm(g.name), g]));
  const idSources = [
    ...sourcesFromPlaytime(playtimeGames),
    ...sourcesFromValuation(valuationGames),
  ];

  const games: CostPerHourGame[] = [];

  for (const g of valuationGames) {
    if (!includeGifts && g.isGift) continue;
    if (g.paid == null || g.paid <= 0) continue;
    if (isBundleTitle(g.title)) continue;

    const played = matchPlaytime(g, byAppId, byName, playtimeGames);
    const hours = played?.hoursForever ?? 0;
    const rateable = hours >= MIN_PLAYED_HOURS_FOR_RATE;
    const steamAppId =
      played?.appId ??
      resolveSteamAppId(g.title, idSources) ??
      g.steamAppId ??
      null;

    games.push({
      title: g.title,
      steamAppId,
      paid: g.paid,
      hours,
      costPerHour: rateable ? g.paid / hours : null,
      current: g.current,
      isGift: g.isGift,
    });
  }

  const playedPaid = games
    .filter((g) => g.costPerHour != null)
    .sort((a, b) => (a.costPerHour ?? 0) - (b.costPerHour ?? 0));

  const unplayedPaid = games
    .filter((g) => g.costPerHour == null)
    .sort((a, b) => b.paid - a.paid);

  const totalPaidMatched = playedPaid.reduce((s, g) => s + g.paid, 0);
  const totalHoursMatched = playedPaid.reduce((s, g) => s + g.hours, 0);
  const blendedCostPerHour =
    totalHoursMatched > 0 ? totalPaidMatched / totalHoursMatched : null;

  return {
    currency,
    games: [...games].sort((a, b) => {
      if (a.costPerHour == null && b.costPerHour == null) return b.paid - a.paid;
      if (a.costPerHour == null) return 1;
      if (b.costPerHour == null) return -1;
      return a.costPerHour - b.costPerHour;
    }),
    playedPaid,
    unplayedPaid,
    blendedCostPerHour,
    totalPaidMatched,
    totalHoursMatched,
    bestValue: playedPaid[0] ?? null,
    worstValue: playedPaid.length ? playedPaid[playedPaid.length - 1] : null,
    biggestUnplayed: unplayedPaid[0] ?? null,
    matchedCount: games.length,
    note: "Cost/hr uses paid from purchase line items and lifetime hours from Account Data / Steam API. Edition packs roll into the base game when both are owned. Bundles are excluded. Under 30 minutes counts as unplayed.",
  };
}
