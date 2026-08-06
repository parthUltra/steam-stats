import { loadLocalAccountData } from "@/lib/data/load-local";
import {
  buildSpendingAnalytics,
  libraryTitlesForValuation,
} from "@/lib/analytics/spending";
import { buildLibraryValuation } from "@/lib/analytics/valuation";
import { buildCostPerHourAnalytics } from "@/lib/analytics/cost-per-hour";
import {
  buildPlaytimeAnalytics,
  type PlayedGame,
} from "@/lib/account-data";
import { loadPriceCache, refreshPricesForTitles } from "@/lib/pricing/prices";
import {
  fetchOwnedGamesFromSteamSession,
  fetchOwnedGamesPlaytime,
} from "@/lib/steam/owned-games";
import { resolveArtworkForAppIds } from "@/lib/steam/artwork-resolve";
import { resolveDlcParents } from "@/lib/steam/dlc-parents";
import { resolveSteamAppId } from "@/lib/steam/resolve-app-id";

function mergePlaytime(
  htmlGames: PlayedGame[],
  apiGames: PlayedGame[],
): {
  games: PlayedGame[];
  source: "account-data-html" | "steam-api" | "merged";
} {
  if (!apiGames.length) {
    return { games: htmlGames, source: "account-data-html" };
  }
  if (!htmlGames.length) {
    return { games: apiGames, source: "steam-api" };
  }
  const byId = new Map<number, PlayedGame>();
  for (const g of htmlGames) byId.set(g.appId, g);
  for (const g of apiGames) {
    const prev = byId.get(g.appId);
    if (!prev) {
      byId.set(g.appId, g);
      continue;
    }
    byId.set(g.appId, {
      ...g,
      // API is authoritative for full library hours
      hoursForever: Math.max(prev.hoursForever, g.hoursForever),
      hours2Weeks: g.hours2Weeks ?? prev.hours2Weeks,
      lastPlayedText: g.lastPlayedText ?? prev.lastPlayedText,
      lastPlayedAt:
        Math.max(prev.lastPlayedAt ?? 0, g.lastPlayedAt ?? 0) ||
        prev.lastPlayedAt ||
        g.lastPlayedAt,
      name: g.name || prev.name,
      fromFamily: Boolean(prev.fromFamily && g.fromFamily),
    });
  }
  return {
    games: [...byId.values()].sort((a, b) => b.hoursForever - a.hoursForever),
    source: "merged",
  };
}

async function loadFullLibraryPlaytime(
  htmlGames: PlayedGame[],
  steamId: string | null,
): Promise<{
  games: PlayedGame[];
  source: "account-data-html" | "steam-api" | "merged";
}> {
  let ownedFromApi: PlayedGame[] = [];
  let source: "account-data-html" | "steam-api" | "merged" =
    "account-data-html";

  const apiKey = process.env.STEAM_API_KEY;
  if (apiKey && steamId) {
    try {
      ownedFromApi = await fetchOwnedGamesPlaytime(steamId, apiKey);
      if (ownedFromApi.length) source = "steam-api";
    } catch {
      // fall through
    }
  }

  try {
    const session = await fetchOwnedGamesFromSteamSession();
    if (session?.games.length) {
      // Session payload already includes family-played titles
      const merged = mergePlaytime(
        mergePlaytime(htmlGames, ownedFromApi).games,
        session.games,
      );
      return {
        games: merged.games,
        source: ownedFromApi.length || htmlGames.length ? "merged" : "steam-api",
      };
    }
  } catch {
    // keep owned / html
  }

  if (ownedFromApi.length) {
    return mergePlaytime(htmlGames, ownedFromApi);
  }
  return { games: htmlGames, source: "account-data-html" };
}

export async function buildDashboard(options?: {
  refreshPrices?: boolean;
  priceLimit?: number;
}) {
  const bundle = await loadLocalAccountData();
  const spending = buildSpendingAnalytics(
    bundle.purchases,
    bundle.licenses,
    bundle.accountSpend,
  );

  const full = await loadFullLibraryPlaytime(
    bundle.playedGames,
    bundle.steamId,
  );
  const playedGames = full.games;
  const playtimeSource = full.source;

  const playtime = buildPlaytimeAnalytics(playedGames, {
    steamId: bundle.steamId,
    source: playtimeSource,
  });

  const libraryTitles = libraryTitlesForValuation(
    bundle.purchases,
    bundle.licenses,
  );
  // Price kept library + gifts you sent (sent only for the separate gifts section art/quotes)
  const giftSentTitles = bundle.purchases
    .filter((p) => p.isGift && !p.refunded)
    .flatMap((p) =>
      (p.lineItems?.map((l) => l.name) ?? p.items).filter(
        (n) => n && !/gift card/i.test(n),
      ),
    );
  const titles = [...new Set([...libraryTitles, ...giftSentTitles])];
  let priceCache = await loadPriceCache();
  const needsRefresh =
    options?.refreshPrices ||
    !priceCache.updatedAt ||
    Object.keys(priceCache.quotes).length < Math.min(10, titles.length);

  if (needsRefresh) {
    priceCache = await refreshPricesForTitles(titles, {
      force: Boolean(options?.refreshPrices),
      limit: options?.priceLimit ?? 60,
    });
  }

  // Prefer resolving titles that look like expansions first; still walk all
  // unknown ids so soundtrack/DLC without ":" in the name get parents too.
  const dlcParents = await resolveDlcParents(
    Object.values(priceCache.quotes)
      .map((q) => q.steamAppId)
      .filter((id): id is number => id != null),
  );

  const valuation = buildLibraryValuation(
    bundle.purchases,
    bundle.licenses,
    priceCache,
    spending,
    { dlcParents },
  );

  const costPerHour = buildCostPerHourAnalytics(
    valuation.games,
    playedGames,
    valuation.currency || spending.currency,
  );

  // Hydrate missing valuation app IDs so shelf / purchase thumbs resolve art
  const idSources = [
    ...playedGames.map((g) => ({ title: g.name, steamAppId: g.appId })),
    ...valuation.games.map((g) => ({
      title: g.title,
      steamAppId: g.steamAppId,
    })),
    ...Object.values(priceCache.quotes).map((q) => ({
      title: q.title,
      steamAppId: q.steamAppId,
    })),
  ];
  for (const g of valuation.games) {
    if (g.steamAppId == null) {
      g.steamAppId = resolveSteamAppId(g.title, idSources);
    }
  }

  const artworkAppIds = [
    ...playedGames.map((g) => g.appId),
    ...valuation.games
      .map((g) => g.steamAppId)
      .filter((id): id is number => id != null),
    ...valuation.giftsSentGames
      .map((g) => g.steamAppId)
      .filter((id): id is number => id != null),
    ...costPerHour.games
      .map((g) => g.steamAppId)
      .filter((id): id is number => id != null),
  ];
  const artwork = await resolveArtworkForAppIds(artworkAppIds);

  return {
    meta: {
      source: bundle.source,
      purchaseRows: bundle.purchases.length,
      licenseRows: bundle.licenses.length,
      priceCacheUpdatedAt: priceCache.updatedAt || null,
      titlesForPricing: titles.length,
      hasSteamApiKey: Boolean(process.env.STEAM_API_KEY),
      libraryGameCount: playedGames.length,
    },
    playtime,
    spending,
    valuation,
    costPerHour,
    artwork,
    recentPurchases: bundle.purchases.slice(0, 15).map((p) => ({
      date: p.dateText,
      items: p.items,
      total: p.total?.amount ?? p.price?.amount ?? null,
      currency:
        p.total?.currencyHint ?? p.price?.currencyHint ?? spending.currency,
      type: p.type,
      refunded: p.refunded,
      discountPct: p.discountPct,
    })),
  };
}

export type DashboardPayload = Awaited<ReturnType<typeof buildDashboard>>;
