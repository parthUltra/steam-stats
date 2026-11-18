import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import { loadOrReport, type DataIssue } from "@/lib/data/data-issues";
import { loadLocalAccountData } from "@/lib/data/load-local";
import {
  pricingTitles,
  withOwnedLicenses,
} from "@/lib/analytics/pricing-titles";
import { loadReceivedGifts } from "@/lib/gifts/received-store";
import { serverError } from "@/lib/http/errors";
import { rejectCrossOrigin } from "@/lib/http/same-origin";
import { spawnDetachedScript } from "@/lib/process/spawn-script";
import { isOffline, skipAutoPriceRefresh } from "@/lib/runtime";
import {
  countLatestQuotes,
  emptyPriceCache,
  hasItadApiKey,
  isStoreLowsWeekFresh,
  isQuoteLatestStoreLow,
  loadPriceCache,
  PRICE_CACHE_TTL_MS,
} from "@/lib/pricing/prices";
import {
  isPriceRefreshRunning,
  priceRefreshPidFile,
  priceRefreshStatusDir,
  readPriceRefreshStatus,
  stopPriceRefresh,
  writePriceRefreshPid,
  writePriceRefreshStatus,
} from "@/lib/pricing/price-refresh-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The price cache, or an empty stand-in plus the issue when the file exists
 * but is corrupt. The file is never written from here.
 */
async function readPriceCache() {
  const issues: DataIssue[] = [];
  const cache = await loadOrReport(
    "price-cache-unreadable",
    loadPriceCache,
    emptyPriceCache,
    issues,
  );
  return { cache, issue: issues[0] ?? null };
}

async function libraryFreshness() {
  // Without a key there is no ITAD check to wait for: the Steam price
  // timestamp decides what is fresh.
  const itadKey = await hasItadApiKey();
  try {
    const bundle = await loadLocalAccountData();
    // An unreadable gifts file only means no gift titles to price.
    const received = await loadOrReport(
      "received-gifts-unreadable",
      loadReceivedGifts,
      () => ({ updatedAt: "", gifts: [] }),
      [],
    );
    const cache = await loadPriceCache();
    const { titles } = pricingTitles(
      {
        ...bundle,
        playedGames: withOwnedLicenses(bundle, Object.values(cache.quotes)),
      },
      received.gifts.map((g) => g.title),
    );
    const now = new Date();
    const counts = countLatestQuotes(titles, cache, now, itadKey);
    return {
      ...counts,
      weekFresh: isStoreLowsWeekFresh(titles, cache, now, itadKey),
      titles,
    };
  } catch {
    const cache = await loadPriceCache();
    const quotes = Object.values(cache.quotes);
    const latest = quotes.filter((q) =>
      isQuoteLatestStoreLow(q, new Date(), itadKey),
    ).length;
    return {
      latest,
      total: quotes.length,
      weekFresh: quotes.length > 0 && latest >= quotes.length,
      titles: [] as string[],
    };
  }
}

function startOneShotRefresh() {
  return spawnDetachedScript("scripts/refresh-prices.ts");
}

/** GET — cheap status from the refresh file + cache stamp. No library parse. */
export async function GET() {
  const { cache, issue } = await readPriceCache();
  const running = await isPriceRefreshRunning();
  // The process id stays server-side.
  const { pid: _pid, ...status } = await readPriceRefreshStatus();
  void _pid;
  const latest = status.latest ?? 0;
  const total = status.libraryTotal ?? status.total ?? 0;
  const updatedMs = cache.updatedAt ? Date.parse(cache.updatedAt) : 0;
  const weekFresh =
    Number.isFinite(updatedMs) &&
    updatedMs > 0 &&
    Date.now() - updatedMs < PRICE_CACHE_TTL_MS;
  return NextResponse.json({
    running,
    latest,
    total,
    weekFresh,
    ttlMs: PRICE_CACHE_TTL_MS,
    priceCacheUpdatedAt: cache.updatedAt || null,
    // The cache file exists but cannot be read: nothing can be refreshed
    // into it until it is restored (see `dataIssue.backup`) or removed.
    ...(issue ? { cacheUnreadable: true, dataIssue: issue } : {}),
    status: running
      ? { ...status, phase: "running" as const, latest, libraryTotal: total }
      : { ...status, latest, libraryTotal: total },
  });
}

/**
 * POST — run a one-shot weekly store-lows refresh if needed.
 * Body: { force?: boolean, restart?: boolean }
 * - Default: no-op when all titles are fresh within 7 days.
 * - force/restart: run even if fresh (e.g. right after saving an ITAD key).
 */
export async function POST(req: Request) {
  const denied = rejectCrossOrigin(req);
  if (denied) return denied;
  try {
    const body = (await req.json().catch(() => ({}))) as {
      force?: boolean;
      restart?: boolean;
    };
    const force = body.force === true || body.restart === true;

    // A refresh would have to save into the cache file; a corrupt one is
    // never written over, so there is nothing to start.
    const { issue } = await readPriceCache();
    if (issue) {
      return NextResponse.json({
        ok: false,
        started: false,
        cacheUnreadable: true,
        dataIssue: issue,
        message: issue.message,
      });
    }

    const { latest, total, weekFresh } = await libraryFreshness();

    // Offline: start nothing, and answer 200 so the page (which POSTs here on
    // every mount) has no failing request in its console.
    if (isOffline()) {
      return NextResponse.json({
        ok: true,
        started: false,
        skipped: true,
        offline: true,
        latest,
        total,
      });
    }

    // `npm run launch:fast`: no automatic refresh; "refresh now" still works.
    if (!force && skipAutoPriceRefresh()) {
      return NextResponse.json({
        ok: true,
        started: false,
        skipped: true,
        skipPrices: true,
        message:
          "Automatic price refresh is off (STEAM_STATS_SKIP_PRICES=1). Use Refresh to run it.",
        latest,
        total,
      });
    }

    if (!force && weekFresh) {
      return NextResponse.json({
        ok: true,
        started: false,
        skipped: true,
        weekFresh: true,
        message: "Store lows are fresh (stored ≤ 7 days). Skipping refresh.",
        latest,
        total,
        ttlMs: PRICE_CACHE_TTL_MS,
      });
    }

    if (force) {
      await stopPriceRefresh();
      await new Promise((r) => setTimeout(r, 300));
    } else if (await isPriceRefreshRunning()) {
      return NextResponse.json({
        ok: true,
        started: false,
        alreadyRunning: true,
        message: "Weekly Store lows refresh already running.",
        latest,
        total,
      });
    }

    await fs.mkdir(priceRefreshStatusDir(), { recursive: true });
    await writePriceRefreshStatus({
      phase: "running",
      message: `Weekly Store lows refresh… ${latest} / ${total}`,
      startedAt: new Date().toISOString(),
      latest,
      libraryTotal: total,
      done: latest,
      total,
      error: undefined,
    });

    const child = startOneShotRefresh();
    if (child.pid) {
      await writePriceRefreshPid(child.pid);
      await writePriceRefreshStatus({
        phase: "running",
        pid: child.pid,
        latest,
        libraryTotal: total,
        done: latest,
        total,
        message: `Weekly Store lows refresh… ${latest} / ${total}`,
      });
    }

    child.on("exit", (code) => {
      void (async () => {
        try {
          await fs.unlink(priceRefreshPidFile()).catch(() => undefined);
          const next = await libraryFreshness();
          if (code === 0) {
            await writePriceRefreshStatus({
              phase: "done",
              message: `Store lows stored ${next.latest} / ${next.total} (valid ~7 days).`,
              latest: next.latest,
              libraryTotal: next.total,
              done: next.latest,
              total: next.total,
            });
          } else {
            await writePriceRefreshStatus({
              phase: "error",
              error: `Price refresh exited with code ${code ?? "?"}`,
              message: "Weekly Store lows refresh failed.",
              latest: next.latest,
              libraryTotal: next.total,
            });
          }
        } catch {
          // ignore
        }
      })();
    });

    return NextResponse.json({
      ok: true,
      started: true,
      forced: force,
      message: "Weekly Store lows refresh started. Results are stored locally.",
      latest,
      total,
      ttlMs: PRICE_CACHE_TTL_MS,
    });
  } catch (err) {
    return serverError("Failed to start refresh", err, { ok: false });
  }
}
