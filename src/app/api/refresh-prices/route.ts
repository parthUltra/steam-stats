import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import { loadLocalAccountData } from "@/lib/data/load-local";
import { titlesForPriceRefresh } from "@/lib/analytics/spending";
import { loadReceivedGifts } from "@/lib/gifts/received-store";
import { rejectCrossOrigin } from "@/lib/http/same-origin";
import { spawnDetachedScript } from "@/lib/process/spawn-script";
import {
  countLatestQuotes,
  isStoreLowsWeekFresh,
  isQuoteLatestStoreLow,
  loadPriceCache,
  PRICE_CACHE_TTL_MS,
} from "@/lib/pricing/prices";
import {
  isPriceRefreshRunning,
  PRICE_REFRESH_PID_FILE,
  PRICE_REFRESH_STATUS_DIR,
  readPriceRefreshStatus,
  stopPriceRefresh,
  writePriceRefreshStatus,
} from "@/lib/pricing/price-refresh-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function libraryFreshness() {
  try {
    const bundle = await loadLocalAccountData();
    const received = await loadReceivedGifts();
    const titles = titlesForPriceRefresh({
      purchases: bundle.purchases,
      licenses: bundle.licenses,
      ownedTitles: bundle.playedGames
        .filter((g) => !g.fromFamily)
        .map((g) => g.name),
      mailGiftTitles: received.gifts.map((g) => g.title),
    });
    const cache = await loadPriceCache();
    const counts = countLatestQuotes(titles, cache);
    return {
      ...counts,
      weekFresh: isStoreLowsWeekFresh(titles, cache),
      titles,
    };
  } catch {
    const cache = await loadPriceCache();
    const quotes = Object.values(cache.quotes);
    const latest = quotes.filter((q) => isQuoteLatestStoreLow(q)).length;
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
  const cache = await loadPriceCache();
  const running = await isPriceRefreshRunning();
  const status = await readPriceRefreshStatus();
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
    const { latest, total, weekFresh } = await libraryFreshness();

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

    await fs.mkdir(PRICE_REFRESH_STATUS_DIR, { recursive: true });
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
      await fs.writeFile(PRICE_REFRESH_PID_FILE, String(child.pid));
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
          await fs.unlink(PRICE_REFRESH_PID_FILE).catch(() => undefined);
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
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Failed to start refresh",
      },
      { status: 500 },
    );
  }
}
