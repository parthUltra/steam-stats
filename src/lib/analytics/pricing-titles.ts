/**
 * The one place that decides which titles must be priced and which playtime
 * titles count as owned for valuation. Used by the dashboard, the
 * /api/refresh-prices route and scripts/refresh-prices.ts so the three never
 * drift apart.
 */
import {
  augmentPlayedWithOwnedLicenses,
  type PlayedGame,
} from "@/lib/account-data";
import {
  hasOwnershipRecord,
  packCoversTitle,
  playtimeTitlesForValuation,
} from "@/lib/analytics/acquisition";
import {
  isOwnedLibraryLicense,
  parseSteamDate,
  titlesForPriceRefresh,
} from "@/lib/analytics/spending";
import type { LocalAccountBundle } from "@/lib/data/load-local";
import { resolveSteamAppId } from "@/lib/steam/resolve-app-id";

/**
 * Playtime rows plus owned licences that never showed up in playtime (never
 * launched). App ids for those come from price quotes and known playtime
 * titles. Pure: returns a new array, inputs are not mutated.
 *
 * Only games are added: a licence for DLC (its app id is in `dlcParents`,
 * data/dlc-parents.json) or for a multi-game pack whose games are themselves
 * in the library is not a library game.
 */
export function withOwnedLicenses(
  bundle: Pick<LocalAccountBundle, "licenses" | "playedGames"> &
    Partial<Pick<LocalAccountBundle, "playedFetchedAt">>,
  quotes: Iterable<{ title: string; steamAppId: number | null }>,
  dlcParents: ReadonlyMap<number, number> = new Map(),
): PlayedGame[] {
  const idSources = [
    ...bundle.playedGames.map((g) => ({ title: g.name, steamAppId: g.appId })),
    ...[...quotes].map((q) => ({ title: q.title, steamAppId: q.steamAppId })),
  ];
  const owned = bundle.licenses.filter(isOwnedLibraryLicense);
  const libraryNames = [
    ...bundle.playedGames.map((g) => g.name),
    ...owned.map((l) => l.item),
  ];
  const isMultiGamePack = (item: string) =>
    libraryNames.some((name) => name !== item && packCoversTitle(item, name));

  return augmentPlayedWithOwnedLicenses(
    bundle.playedGames,
    owned
      .filter((lic) => !isMultiGamePack(lic.item))
      .map((lic) => ({
        item: lic.item,
        dateText: lic.dateText,
        addedAt:
          parseSteamDate(lic.dateText, { now: bundle.playedFetchedAt })
            ?.getTime() ?? null,
      })),
    (title) => {
      const id = resolveSteamAppId(title, idSources);
      return id != null && dlcParents.has(id) ? null : id;
    },
  );
}

/**
 * `ownedTitles`: playtime titles kept for the Value shelf.
 * `titles`: everything that needs a price quote (library + sent gifts + owned
 * play + mail gifts).
 *
 * Pass `playedGames` AFTER `withOwnedLicenses`, so a title that is valued is
 * also queued for pricing.
 */
export function pricingTitles(
  bundle: Pick<LocalAccountBundle, "purchases" | "licenses" | "playedGames">,
  mailGiftTitles: string[],
): {
  titles: string[];
  ownedTitles: string[];
  /** Owned titles with no licence, purchase or gift record behind them. */
  unrecordedOwnedTitles: string[];
} {
  const ownedTitles = playtimeTitlesForValuation(
    bundle.playedGames,
    bundle.licenses,
    bundle.purchases,
    mailGiftTitles,
  );
  const titles = titlesForPriceRefresh({
    purchases: bundle.purchases,
    licenses: bundle.licenses,
    ownedTitles,
    mailGiftTitles,
  });
  const unrecordedOwnedTitles = ownedTitles.filter(
    (title) =>
      !hasOwnershipRecord(
        title,
        bundle.licenses,
        bundle.purchases,
        mailGiftTitles,
      ),
  );
  return { titles, ownedTitles, unrecordedOwnedTitles };
}
