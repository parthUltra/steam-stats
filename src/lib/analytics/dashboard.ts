/**
 * Dashboard request path. Read-only by construction:
 *
 *   loadDashboardInputs()  file reads only — no network, no writes
 *   computeDashboard()     pure and synchronous — no I/O, no clock
 *   buildDashboard()       the two composed
 *
 * Everything that talks to Steam / ITAD or writes a cache (playtime fetch,
 * price refresh, DLC-parent and artwork resolution) lives in scripts/.
 */
import { loadOrReport, type DataIssue } from "@/lib/data/data-issues";
import {
  loadLocalAccountData,
  type LocalAccountBundle,
} from "@/lib/data/load-local";
import {
  applySteamInrListPrices,
  buildSpendingAnalytics,
} from "@/lib/analytics/spending";
import { buildLibraryValuation } from "@/lib/analytics/valuation";
import { buildCostPerHourAnalytics } from "@/lib/analytics/cost-per-hour";
import {
  buildPlaytimeAnalytics,
  type PlaytimeAnalytics,
} from "@/lib/account-data";
import { resolveItadApiKey } from "@/lib/pricing/itad-credentials";
import {
  emptyPriceCache,
  loadPriceCache,
  resolveAndApplyStoreRegion,
  type PriceCache,
} from "@/lib/pricing/prices";
import {
  storeRegionLabel,
  type StoreRegion,
} from "@/lib/pricing/store-region";
import {
  legacyUrls,
  loadArtworkCache,
  type ArtworkUrls,
} from "@/lib/steam/artwork-resolve";
import { readDlcParents } from "@/lib/steam/dlc-parents";
import { resolveSteamAppId } from "@/lib/steam/resolve-app-id";
import {
  loadReceivedGifts,
  type GiftsReceivedStore,
} from "@/lib/gifts/received-store";
import { parseSteamDate } from "@/lib/dates";
import { normTitle } from "@/lib/titles";
import {
  pricingTitles,
  withOwnedLicenses,
} from "@/lib/analytics/pricing-titles";
import type { ArtworkMap, DashboardPayload } from "@/lib/analytics/contracts";
import { buildStats } from "@/lib/stats";

export type { DashboardPayload } from "@/lib/analytics/contracts";

export type DashboardInputs = {
  bundle: LocalAccountBundle;
  priceCache: PriceCache;
  region: StoreRegion;
  receivedGifts: GiftsReceivedStore;
  /** dlcAppId → parentAppId, cache read only */
  dlcParents: Map<number, number>;
  /** appId → URLs, cache read only */
  artworkCache: Record<string, ArtworkUrls>;
  hasItadApiKey: boolean;
  /** Cache files that exist but could not be read (see loadDashboardInputs). */
  dataIssues?: DataIssue[];
};

function quoteAppIdsOf(priceCache: PriceCache): number[] {
  return Object.values(priceCache.quotes)
    .map((q) => q.steamAppId)
    .filter((id): id is number => id != null);
}

/**
 * File reads only: no network, no writes.
 *
 * A cache file that exists but is corrupt does not fail the dashboard: it is
 * reported in `dataIssues`, left untouched on disk, and replaced in memory by
 * an empty stand-in (which is never saved — nothing here writes).
 */
export async function loadDashboardInputs(): Promise<DashboardInputs> {
  const bundle = await loadLocalAccountData();
  const dataIssues: DataIssue[] = [];
  const loadedCache = await loadOrReport<PriceCache>(
    "price-cache-unreadable",
    loadPriceCache,
    emptyPriceCache,
    dataIssues,
  );
  const receivedGifts = await loadOrReport<GiftsReceivedStore>(
    "received-gifts-unreadable",
    loadReceivedGifts,
    () => ({ updatedAt: "", gifts: [] }),
    dataIssues,
  );
  // persist:false — a GET must never rewrite price-cache.json. The refresh
  // script persists a newly detected region.
  const { region, cache: priceCache } = await resolveAndApplyStoreRegion(
    loadedCache,
    bundle,
    { persist: false },
  );
  const [dlcParents, artwork, itadKey] = await Promise.all([
    readDlcParents(quoteAppIdsOf(priceCache)),
    loadArtworkCache(),
    resolveItadApiKey(),
  ]);
  return {
    bundle,
    priceCache,
    region,
    receivedGifts,
    dlcParents,
    artworkCache: artwork.byAppId,
    hasItadApiKey: Boolean(itadKey),
    dataIssues,
  };
}

/**
 * Where the playtime snapshot came from — what the writing script recorded
 * in games-played.json (`bundle.playedSource`, set by the loader),
 * never a guess from the row count. The UI shows "Partial library snapshot"
 * for "account-data-html" (the Account Data games page is a short list), so an
 * unknown source is reported as that.
 */
export function playtimeSourceFromSnapshot(
  recorded: string | null | undefined,
): PlaytimeAnalytics["source"] {
  if (recorded === "steam-session-api" || recorded === "steam-api") {
    return "steam-api";
  }
  if (recorded === "merged") return "merged";
  return "account-data-html";
}

/**
 * "Now" for stats: when playtime was fetched, else the newest last-played
 * stamp. Never the wall clock, so the same inputs give the same payload.
 */
function snapshotTime(bundle: LocalAccountBundle): number {
  const fetched = bundle.playedFetchedAt
    ? Date.parse(bundle.playedFetchedAt)
    : NaN;
  if (Number.isFinite(fetched)) return fetched;
  return bundle.playedGames.reduce(
    (max, g) => Math.max(max, g.lastPlayedAt ?? 0),
    0,
  );
}

/** ISO date / date-time → epoch ms (a bare date is local midnight); null if absent. */
function epochMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = /^\d{4}-\d{2}-\d{2}$/.test(iso)
    ? (parseSteamDate(iso)?.getTime() ?? NaN)
    : Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** Pure and synchronous: no I/O, no clock. */
export function computeDashboard(inputs: DashboardInputs): DashboardPayload {
  const { bundle, priceCache, region, receivedGifts, dlcParents } = inputs;

  const now = snapshotTime(bundle);

  const spending = buildSpendingAnalytics(
    bundle.purchases,
    bundle.licenses,
    bundle.accountSpend,
    { now },
  );

  const mailGiftTitles = receivedGifts.gifts.map((g) => g.title);
  const mailGiftSenders = new Map<string, string>();
  const mailGiftReceivedAt = new Map<string, string>();
  for (const g of receivedGifts.gifts) {
    if (g.fromPersona) mailGiftSenders.set(normTitle(g.title), g.fromPersona);
    if (g.receivedAt) mailGiftReceivedAt.set(normTitle(g.title), g.receivedAt);
  }

  // Owned licenses missing from playtime (never launched) still belong on the
  // shelf — resolve app ids from price quotes + known playtime titles.
  const playedGames = withOwnedLicenses(
    bundle,
    Object.values(priceCache.quotes),
    dlcParents,
  );

  // One owned-title list, computed after the augment, feeds both the pricing
  // queue and the valuation.
  const { titles, ownedTitles, unrecordedOwnedTitles } = pricingTitles(
    { ...bundle, playedGames },
    mailGiftTitles,
  );

  const playtime = buildPlaytimeAnalytics(playedGames, {
    steamId: bundle.steamId,
    source: playtimeSourceFromSnapshot(bundle.playedSource),
  });

  // Month-detail full prices: Steam store list for detected country
  applySteamInrListPrices(spending.monthly, priceCache.quotes);

  const valuation = buildLibraryValuation(
    bundle.purchases,
    bundle.licenses,
    priceCache,
    spending,
    {
      dlcParents,
      ownedTitles,
      mailGiftTitles,
      mailGiftSenders,
      mailGiftReceivedAt,
    },
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
  const valuationRows = [
    ...valuation.games,
    ...valuation.giftsSentGames,
    ...valuation.giftsReceivedGames,
    ...valuation.freeGames,
    ...valuation.bundleGames,
    ...valuation.ownershipGrantGames,
    ...valuation.unknownUnpaidGames,
  ];
  for (const g of valuationRows) {
    if (g.steamAppId == null) {
      g.steamAppId = resolveSteamAppId(g.title, idSources);
    }
  }

  // Artwork: cached URLs where we have them, deterministic legacy CDN paths
  // otherwise (scripts/refresh-prices.ts fills the cache).
  const artworkAppIds = [
    ...playedGames.map((g) => g.appId),
    ...quoteAppIdsOf(priceCache),
    ...valuationRows.map((g) => g.steamAppId),
    ...costPerHour.games.map((g) => g.steamAppId),
  ];
  const artwork: ArtworkMap = {};
  for (const id of artworkAppIds) {
    if (id == null || !(id > 0)) continue;
    const key = String(id);
    if (artwork[key]) continue;
    const { library, header, capsule } =
      inputs.artworkCache[key] ?? legacyUrls(id);
    // Only the URLs: cache bookkeeping (hashed / updatedAt) stays server-side.
    artwork[key] = { library, header, capsule };
  }

  // `games` is exactly playedPaid + unplayedPaid again; the client reads only
  // those two, so the combined list is not sent.
  const { games: _allCostPerHourGames, ...costPerHourPayload } = costPerHour;
  void _allCostPerHourGames;

  const stats = buildStats({
    playedGames,
    purchases: bundle.purchases,
    licenses: bundle.licenses,
    spending,
    valuation,
    costPerHour,
    currency: valuation.currency || spending.currency,
    now,
    // Every gift we can date: Steam gift licences (on the shelf rows) and
    // imported gift e-mails.
    receivedGifts: [
      ...valuation.giftsReceivedGames.map((g) => ({
        title: g.title,
        receivedAt: epochMs(g.receivedAt),
      })),
      ...receivedGifts.gifts.map((g) => ({
        title: g.title,
        receivedAt: epochMs(g.receivedAt),
      })),
    ],
  });

  return {
    meta: {
      source: bundle.source,
      purchaseRows: bundle.purchases.length,
      licenseRows: bundle.licenses.length,
      priceCacheUpdatedAt: priceCache.updatedAt || null,
      titlesForPricing: titles.length,
      hasSteamApiKey: false,
      hasItadApiKey: inputs.hasItadApiKey,
      storeCountry: region.country,
      storeCurrency: region.currency,
      storeRegionLabel: storeRegionLabel(region.country),
      storeRegionSource: region.source,
      libraryGameCount: playedGames.length,
      mailGiftsLastSyncedAt: receivedGifts.lastMailSyncedAt ?? null,
      mailGiftsCount: receivedGifts.gifts.length,
      mailGifts: receivedGifts.gifts.map((g) => ({
        title: g.title,
        fromPersona: g.fromPersona ?? null,
        receivedAt: g.receivedAt ?? null,
        // A gift redemption URL is a bearer link: it never leaves the server
        giftUrl: null,
        subject: g.subject ?? null,
        source: g.source,
        importedAt: g.importedAt,
      })),
      sourceStatus: bundle.sourceStatus ?? null,
      needsReparse: Object.values(bundle.sourceStatus ?? {}).some(
        (s) => s.status === "unknown",
      ),
      playedFetchedAt: bundle.playedFetchedAt,
      accountSpendFetchedAt: bundle.accountSpendFetchedAt ?? null,
      dataIssues: inputs.dataIssues ?? [],
      ownedWithoutRecordCount: unrecordedOwnedTitles.length,
    },
    playtime,
    spending,
    valuation,
    costPerHour: costPerHourPayload,
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
    stats,
  };
}

export async function buildDashboard(): Promise<DashboardPayload> {
  return computeDashboard(await loadDashboardInputs());
}
