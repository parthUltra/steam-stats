/**
 * One-shot weekly store lows refresh (minimal ITAD traffic).
 * Auto-detects Steam country from wallet currency / login history.
 * Stores results in data/price-cache.json (valid ~7 days).
 *
 * Typical cost for ~80–200 titles with cached Steam app ids:
 *   - 0–1× POST /lookup/id/shop/61/v1  (only missing itadIds)
 *   - 1×   POST /games/prices/v3       (current + Steam store low, detected country)
 *
 * After pricing it also fills the two caches the dashboard only ever reads:
 * data/dlc-parents.json and data/artwork-cache.json.
 *
 * Usage: npm run refresh:prices
 */
import path from "node:path";
import { loadOrReport, type DataIssue } from "../src/lib/data/data-issues";
import { loadLocalEnv } from "../src/lib/process/load-env";
import { loadLocalAccountData } from "../src/lib/data/load-local";
import {
  pricingTitles,
  withOwnedLicenses,
} from "../src/lib/analytics/pricing-titles";
import { computeDashboard, loadDashboardInputs } from "../src/lib/analytics/dashboard";
import { resolveArtworkForAppIds } from "../src/lib/steam/artwork-resolve";
import { resolveDlcParents } from "../src/lib/steam/dlc-parents";
import { loadReceivedGifts } from "../src/lib/gifts/received-store";
import {
  countLatestQuotes,
  hasItadApiKey,
  loadPriceCache,
  pickOldestTitles,
  refreshPricesForTitles,
  resolveAndApplyStoreRegion,
  type PriceCache,
} from "../src/lib/pricing/prices";
import { storeRegionLabel } from "../src/lib/pricing/store-region";
import { writePriceRefreshStatus } from "../src/lib/pricing/price-refresh-status";

/**
 * The dashboard reads DLC parents and artwork from disk and never resolves
 * them itself, so resolve them here, right after pricing. Best-effort: a
 * failure leaves the previous caches in place and does not fail the refresh.
 */
async function fillDashboardCaches(cache: PriceCache) {
  try {
    const quoteAppIds = Object.values(cache.quotes)
      .map((q) => q.steamAppId)
      .filter((id): id is number => id != null);
    const parents = await resolveDlcParents(quoteAppIds);

    // Artwork ids depend on the valuation (which depends on DLC parents), so
    // take them from a dashboard build: its artwork map is keyed by exactly
    // the app ids the page will ask for.
    const payload = computeDashboard(await loadDashboardInputs());
    const artworkIds = Object.keys(payload.artwork).map(Number);
    await resolveArtworkForAppIds(artworkIds);
    console.log(
      `Caches: ${parents.size} DLC parents · artwork for ${artworkIds.length} apps`,
    );
  } catch (err) {
    console.warn(
      "DLC / artwork cache refresh skipped:",
      err instanceof Error ? err.message : err,
    );
  }
}

async function main() {
  // Run from a terminal, nothing has loaded .env.local: read it the way the
  // server does, so an ITAD key kept there is found (resolveItadApiKey still
  // prefers a key saved in the app). No-op when the server spawned us.
  loadLocalEnv(path.resolve(__dirname, ".."));
  const bundle = await loadLocalAccountData();
  // An unreadable gifts file must not stop the price refresh: it is left
  // untouched and the refresh runs without gift titles.
  const giftIssues: DataIssue[] = [];
  const received = await loadOrReport(
    "received-gifts-unreadable",
    loadReceivedGifts,
    () => ({ updatedAt: "", gifts: [] }),
    giftIssues,
  );
  for (const issue of giftIssues) console.warn(issue.message);
  // Persists a newly detected region (the dashboard request path never writes).
  const { region, cache: regionCache } = await resolveAndApplyStoreRegion();
  const { titles } = pricingTitles(
    {
      ...bundle,
      playedGames: withOwnedLicenses(bundle, Object.values(regionCache.quotes)),
    },
    received.gifts.map((g) => g.title),
  );
  const label = storeRegionLabel(region.country);
  console.log(
    `Weekly ${label} (${region.country}/${region.currency}) lows for ${titles.length} titles (library + gifts)…`,
  );

  if (!(await hasItadApiKey())) {
    console.warn(
      `No IsThereAnyDeal key — paste one via Value → Get ${label} lows.`,
    );
  }

  // Without a key, "fresh" means the Steam price was read this week — the
  // same rule the server uses to decide whether to start this script.
  const itadKey = await hasItadApiKey();
  const cacheBefore = await loadPriceCache();
  const before = countLatestQuotes(titles, cacheBefore, new Date(), itadKey);
  await writePriceRefreshStatus({
    phase: "running",
    message: `Weekly refresh… ${before.latest} / ${before.total}`,
    startedAt: new Date().toISOString(),
    latest: before.latest,
    libraryTotal: before.total,
    done: before.latest,
    total: before.total,
    error: undefined,
  });

  const stale = pickOldestTitles(titles, cacheBefore, {
    skipLatestToday: true,
    limit: titles.length,
    hasItadKey: itadKey,
  });
  const queue = stale.length > 0 ? stale : titles;
  console.log(`Updating ${queue.length} titles (fast ITAD path)…`);

  const cache = await refreshPricesForTitles(queue, {
    force: true,
    itadFastPath: true,
    limit: Math.max(queue.length, 1),
    onProgress: async ({ done, total }) => {
      if (done === 0 || done === total || done % 20 === 0) {
        const live = await loadPriceCache();
        const c = countLatestQuotes(titles, live, new Date(), itadKey);
        await writePriceRefreshStatus({
          phase: "running",
          latest: c.latest,
          libraryTotal: c.total,
          done: c.latest,
          total: c.total,
          message: `Weekly refresh… ${c.latest} / ${c.total}`,
        });
      }
    },
  });

  const { latest, total } = countLatestQuotes(titles, cache, new Date(), itadKey);
  const withLow = Object.values(cache.quotes).filter(
    (q) => q.lowestInr != null && q.lowestInr > 0,
  ).length;
  const withItadId = Object.values(cache.quotes).filter((q) => q.itadId)
    .length;

  // Before reporting "done": that status is what tells the server this
  // process has finished, and it is still writing caches until here.
  await fillDashboardCaches(cache);

  await writePriceRefreshStatus({
    phase: "done",
    latest,
    libraryTotal: total,
    done: latest,
    total,
    message: `${label} lows stored ${latest} / ${total} (valid ~7 days).`,
  });

  console.log(
    `Done. Fresh ${latest}/${total} · ${withLow} store lows · ${withItadId} cached itadIds · ${region.country} · ${cache.updatedAt}`,
  );
}

main().catch(async (err) => {
  console.error(err);
  try {
    await writePriceRefreshStatus({
      phase: "error",
      error: err instanceof Error ? err.message : String(err),
      message: "Weekly store lows refresh failed.",
    });
  } catch {
    // ignore
  }
  process.exit(1);
});
