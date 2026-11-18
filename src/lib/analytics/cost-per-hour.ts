import type { PlayedGame } from "@/lib/account-data";
import {
  effectiveShelfNow,
  type ValuationGame,
} from "@/lib/analytics/valuation";
import { packCoversTitle, titlesSoftMatch } from "@/lib/analytics/acquisition";
import {
  isBundleTitle,
  isRedundantPackSku,
  stripEditionSuffix,
} from "@/lib/analytics/edition-packs";
import { normTitle as norm } from "@/lib/titles";
import {
  resolveSteamAppId,
  sourcesFromPlaytime,
  sourcesFromValuation,
} from "@/lib/steam/resolve-app-id";

/** Below this, playtime is too noisy for ₹/hr — treat as unplayed. */
export const MIN_PLAYED_HOURS_FOR_RATE = 0.5; // 30 minutes

/** Divisor floor so cost/hr never exceeds what you paid for the game. */
export const MIN_HOURS_DIVISOR = 1;

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
  /**
   * @deprecated Same value as `totalHoursRateDivisor`. Not hours played: each
   * title under 1 h counts as 1 h here.
   */
  totalHoursMatched: number;
  /**
   * Divisor of `blendedCostPerHour`: hours of the played paid titles with each
   * title floored at 1 h (so a rate never exceeds what was paid).
   */
  totalHoursRateDivisor: number;
  /** Hours actually played across the same titles — the figure to display. */
  totalHoursPlayed: number;
  bestValue: CostPerHourGame | null;
  worstValue: CostPerHourGame | null;
  biggestUnplayed: CostPerHourGame | null;
  matchedCount: number;
  note: string;
};

/**
 * The playtime row for a shelf row. Identity first (app id, exact name), then
 * an edition / store SKU of a played title. Never a title that merely shares
 * a prefix: a sequel or a "Base: Subtitle" game has its own hours or none.
 */
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
  const exact = byName.get(norm(game.title));
  if (exact) return exact;

  const baseKey = stripEditionSuffix(game.title);
  if (baseKey) {
    const base = byName.get(baseKey);
    if (base) return base;
  }

  // "X: Ultimate Edition" ↔ "X" — the remainder is only an edition label
  let best: PlayedGame | null = null;
  for (const p of playtimeGames) {
    if (!titlesSoftMatch(game.title, p.name)) continue;
    if (!best || p.name.length > best.name.length) best = p;
  }
  if (best) return best;

  // A row priced as its own app that has no playtime row was not played.
  // Only an unpriced row (store SKU names like "… (ROW)") is looked up by
  // title, and that lookup rejects sequels.
  if (game.steamAppId != null) return null;
  const resolvedId = resolveSteamAppId(
    game.title,
    sourcesFromPlaytime(playtimeGames),
  );
  return resolvedId == null ? null : (byAppId.get(resolvedId) ?? null);
}

/**
 * Split each multi-game pack's price across the shelf games it covers, in
 * proportion to their shelf price (evenly when none is priced). Returns the
 * packs that were split and the share each covered game received.
 */
function splitPackPrices(
  shelf: ValuationGame[],
  includeGifts: boolean,
): { packs: Set<ValuationGame>; shares: Map<ValuationGame, number> } {
  const packs = new Set<ValuationGame>();
  const shares = new Map<ValuationGame, number>();
  const eligible = (g: ValuationGame) => includeGifts || !g.isGift;

  for (const pack of shelf) {
    if (!eligible(pack) || pack.paid == null || pack.paid <= 0) continue;
    if (!isRedundantPackSku(pack, shelf)) continue;
    const members = shelf.filter(
      (g) =>
        g !== pack &&
        eligible(g) &&
        !isBundleTitle(g.title) &&
        packCoversTitle(pack.title, g.title),
    );
    if (!members.length) continue;
    const prices = members.map((g) => effectiveShelfNow(g) ?? 0);
    const total = prices.reduce((a, b) => a + b, 0);
    members.forEach((g, i) => {
      const weight = total > 0 ? prices[i] / total : 1 / members.length;
      shares.set(g, (shares.get(g) ?? 0) + pack.paid! * weight);
    });
    packs.add(pack);
  }
  return { packs, shares };
}

/** Hours used as the cost/hr divisor — at least 1h so rate ≤ paid. */
export function hoursForCostRate(hours: number): number {
  return Math.max(hours, MIN_HOURS_DIVISOR);
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

  // A single-app "Collection" (Halo MCC) is a game like any other. Only a
  // pack whose games are on the shelf is left out as a row — its price moves
  // onto those games.
  const { packs, shares } = splitPackPrices(valuationGames, includeGifts);

  for (const g of valuationGames) {
    if (!includeGifts && g.isGift) continue;
    if (packs.has(g)) continue;
    const paid = (g.paid ?? 0) + (shares.get(g) ?? 0);
    if (paid <= 0) continue;

    const played = matchPlaytime(g, byAppId, byName, playtimeGames);
    const rawHours = played?.hoursForever;
    const hours =
      typeof rawHours === "number" && Number.isFinite(rawHours) ? rawHours : 0;
    const rateable = hours >= MIN_PLAYED_HOURS_FOR_RATE;
    const steamAppId =
      played?.appId ??
      g.steamAppId ??
      resolveSteamAppId(g.title, idSources) ??
      null;

    games.push({
      title: g.title,
      steamAppId,
      paid,
      hours,
      costPerHour: rateable ? paid / hoursForCostRate(hours) : null,
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
  const totalHoursMatched = playedPaid.reduce(
    (s, g) => s + hoursForCostRate(g.hours),
    0,
  );
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
    totalHoursRateDivisor: totalHoursMatched,
    totalHoursPlayed: playedPaid.reduce((s, g) => s + g.hours, 0),
    bestValue: playedPaid[0] ?? null,
    worstValue: playedPaid.length ? playedPaid[playedPaid.length - 1] : null,
    biggestUnplayed: unplayedPaid[0] ?? null,
    matchedCount: games.length,
    note: "Cost/hr uses paid from purchase line items and lifetime hours from Account Data / Steam API. Under 1 hour played counts as 1 hour (so cost/hr never exceeds what you paid). Edition packs roll into the base when both are owned. A collection / bundle's price is split across the games it includes, by shelf price. Under 30 minutes counts as unplayed.",
  };
}
