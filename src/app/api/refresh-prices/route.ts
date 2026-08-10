import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { loadLocalAccountData } from "@/lib/data/load-local";
import { libraryTitlesForValuation } from "@/lib/analytics/spending";
import {
  countLatestQuotes,
  isIndiaLowsWeekFresh,
  isQuoteLatestIndiaLow,
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

const ROOT = process.cwd();

async function libraryFreshness() {
  try {
    const bundle = await loadLocalAccountData();
    const titles = libraryTitlesForValuation(bundle.purchases, bundle.licenses);
    const cache = await loadPriceCache();
    const counts = countLatestQuotes(titles, cache);
    return {
      ...counts,
      weekFresh: isIndiaLowsWeekFresh(titles, cache),
      titles,
    };
  } catch {
    const cache = await loadPriceCache();
    const quotes = Object.values(cache.quotes);
    const latest = quotes.filter((q) => isQuoteLatestIndiaLow(q)).length;
    return {
      latest,
      total: quotes.length,
      weekFresh: quotes.length > 0 && latest >= quotes.length,
      titles: [] as string[],
    };
  }
}

function startOneShotRefresh() {
  const child = spawn("npm", ["run", "refresh:prices", "--silent"], {
    cwd: ROOT,
    detached: true,
    stdio: "ignore",
    shell: true,
    env: { ...process.env },
  });
  child.unref();
  return child;
}

/** GET — weekly India-low coverage + one-shot refresh status. */
export async function GET() {
  const cache = await loadPriceCache();
  const running = await isPriceRefreshRunning();
  const status = await readPriceRefreshStatus();
  const { latest, total, weekFresh } = await libraryFreshness();
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
 * POST — run a one-shot weekly India-lows refresh if needed.
 * Body: { force?: boolean, restart?: boolean }
 * - Default: no-op when all titles are fresh within 7 days.
 * - force/restart: run even if fresh (e.g. right after saving an ITAD key).
 */
export async function POST(req: Request) {
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
        message: "India lows are fresh (stored ≤ 7 days). Skipping refresh.",
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
        message: "Weekly India lows refresh already running.",
        latest,
        total,
      });
    }

    await fs.mkdir(PRICE_REFRESH_STATUS_DIR, { recursive: true });
    await writePriceRefreshStatus({
      phase: "running",
      message: `Weekly India lows refresh… ${latest} / ${total}`,
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
        message: `Weekly India lows refresh… ${latest} / ${total}`,
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
              message: `India lows stored ${next.latest} / ${next.total} (valid ~7 days).`,
              latest: next.latest,
              libraryTotal: next.total,
              done: next.latest,
              total: next.total,
            });
          } else {
            await writePriceRefreshStatus({
              phase: "error",
              error: `Price refresh exited with code ${code ?? "?"}`,
              message: "Weekly India lows refresh failed.",
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
      message: "Weekly India lows refresh started. Results are stored locally.",
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
