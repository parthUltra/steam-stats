/**
 * One-shot weekly store lows refresh (minimal ITAD traffic).
 * Auto-detects Steam country from wallet currency / login history.
 * Stores results in data/price-cache.json (valid ~7 days).
 *
 * Typical cost for ~80–200 titles with cached Steam app ids:
 *   - 0–1× POST /lookup/id/shop/61/v1  (only missing itadIds)
 *   - 1×   POST /games/prices/v3       (current + Steam store low, detected country)
 *
 * Usage: npm run refresh:prices
 */
import { loadLocalAccountData } from "../src/lib/data/load-local";
import { libraryTitlesForValuation } from "../src/lib/analytics/spending";
import {
  countLatestQuotes,
  hasItadApiKey,
  loadPriceCache,
  pickOldestTitles,
  refreshPricesForTitles,
  resolveAndApplyStoreRegion,
} from "../src/lib/pricing/prices";
import { storeRegionLabel } from "../src/lib/pricing/store-region";
import { writePriceRefreshStatus } from "../src/lib/pricing/price-refresh-status";

async function main() {
  const bundle = await loadLocalAccountData();
  const titles = libraryTitlesForValuation(bundle.purchases, bundle.licenses);
  const { region } = await resolveAndApplyStoreRegion();
  const label = storeRegionLabel(region.country);
  console.log(
    `Weekly ${label} (${region.country}/${region.currency}) lows for ${titles.length} library titles…`,
  );

  if (!(await hasItadApiKey())) {
    console.warn(
      `No IsThereAnyDeal key — paste one via Value → Get ${label} lows.`,
    );
  }

  const cacheBefore = await loadPriceCache();
  const before = countLatestQuotes(titles, cacheBefore);
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
        const c = countLatestQuotes(titles, live);
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

  const { latest, total } = countLatestQuotes(titles, cache);
  const withLow = Object.values(cache.quotes).filter(
    (q) => q.lowestInr != null && q.lowestInr > 0,
  ).length;
  const withItadId = Object.values(cache.quotes).filter((q) => q.itadId)
    .length;

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
