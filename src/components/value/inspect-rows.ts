import type { DashboardPayload } from "@/lib/analytics/dashboard";
import {
  effectiveShelfLowest,
  effectiveShelfLowestBestKnown,
  effectiveShelfNow,
} from "@/lib/analytics/valuation";
import { isRedundantPackSku } from "@/lib/analytics/edition-packs";

export type InspectMode = "spent" | "shelfNow" | "lowest";

export type ValuationGameRow = DashboardPayload["valuation"]["games"][number];

export type InspectRow = {
  game: ValuationGameRow;
  amount: number | null;
};

export function looksLikeAddonPack(title: string): boolean {
  return /\b(collaboration pack|collab pack|cosmetic pack|soundtrack|deluxe upgrade|season pass)\b/i.test(
    title,
  );
}

/** Hide freebie DLC / collab packs that only clutter Lowest (₹0, no live price). */
export function isRedundantLowestRow(
  game: ValuationGameRow,
  games: ValuationGameRow[],
): boolean {
  if (isRedundantPackSku(game, games)) return true;

  // Complimentary free rows: Butcher's Circus, Dredge collab, etc.
  if (game.kind === "free") return true;

  // Free/unresolved addon sharing the base game's Steam app id
  if (
    game.steamAppId != null &&
    looksLikeAddonPack(game.title) &&
    games.some(
      (o) =>
        o !== game &&
        o.steamAppId === game.steamAppId &&
        o.kind !== "free" &&
        !looksLikeAddonPack(o.title),
    )
  ) {
    return true;
  }

  return false;
}

export function buildInspectRows(
  games: ValuationGameRow[],
  mode: InspectMode,
  opts?: { calibrating?: boolean },
): InspectRow[] {
  const rows: InspectRow[] = [];
  for (const game of games) {
    if (game.kind === "gifted_by_me") continue;

    if (mode === "spent") {
      // Include pack/collection purchases — they are real wallet spend
      if (game.paid != null && game.paid > 0) {
        rows.push({ game, amount: game.paid });
      }
      continue;
    }

    if (mode === "shelfNow") {
      if (isRedundantPackSku(game, games)) continue;
      // Don't list free addon packs that only exist as collab/DLC rows
      if (game.kind === "free" && looksLikeAddonPack(game.title)) continue;
      if (
        game.kind === "free" &&
        game.steamAppId != null &&
        games.some(
          (o) =>
            o !== game &&
            o.steamAppId === game.steamAppId &&
            o.kind !== "free",
        )
      ) {
        continue;
      }
      const now = effectiveShelfNow(game);
      if (now != null) rows.push({ game, amount: now });
      continue;
    }

    // Lowest
    if (isRedundantLowestRow(game, games)) continue;

    const low = opts?.calibrating
      ? effectiveShelfLowestBestKnown(game)
      : effectiveShelfLowest(game);
    const bought =
      (game.paid != null && game.paid > 0) || game.kind === "purchased";
    const onShelf = effectiveShelfNow(game) != null;
    if (low != null || bought || onShelf) {
      rows.push({ game, amount: low });
    }
  }
  return rows;
}
