/**
 * Pre-warm CheapShark / Steam price cache for library titles.
 * Usage: npm run refresh:prices
 */
import { loadLocalAccountData } from "../src/lib/data/load-local";
import { libraryTitlesForValuation } from "../src/lib/analytics/spending";
import { refreshPricesForTitles } from "../src/lib/pricing/prices";

async function main() {
  const bundle = await loadLocalAccountData();
  const titles = libraryTitlesForValuation(bundle.purchases, bundle.licenses);
  console.log(`Refreshing prices for ${titles.length} library titles…`);
  const cache = await refreshPricesForTitles(titles, {
    force: true,
    limit: 100,
  });
  const resolved = Object.values(cache.quotes).filter(
    (q) => q.source !== "unresolved" && q.steamAppId,
  ).length;
  console.log(
    `Done. ${resolved} resolved · cache ${cache.updatedAt} · file data/price-cache.json`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
