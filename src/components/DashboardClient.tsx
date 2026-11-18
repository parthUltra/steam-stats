"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCwIcon } from "lucide-react";
import { AppBrand, DashboardView } from "@/components/DashboardView";
import type { DashboardPayload } from "@/lib/analytics/dashboard";
import { Button } from "@/components/ui/button";

export type LowsProgress = {
  latest: number;
  total: number;
  running: boolean;
};

/** Store-price cache state shown in the header. */
export type PriceStatus = {
  phase: "checking" | "idle" | "running" | "offline" | "error";
  /** ISO time the price cache was last written. */
  updatedAt: string | null;
  latest: number;
  total: number;
  /** Older than the weekly window, or missing quotes. */
  stale: boolean;
  /** Short reason for `error`. */
  message?: string;
};

type StatusBody = {
  running?: boolean;
  latest?: number;
  total?: number;
  weekFresh?: boolean;
  priceCacheUpdatedAt?: string | null;
};

type RefreshBody = {
  latest?: number;
  total?: number;
  started?: boolean;
  alreadyRunning?: boolean;
  skipped?: boolean;
  offline?: boolean;
  error?: string;
};

async function fetchDashboard(): Promise<DashboardPayload> {
  const res = await fetch("/api/dashboard", { cache: "no-store" });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "Failed to load");
  return json as DashboardPayload;
}

export function DashboardClient({
  initialData,
  initialError = null,
}: {
  initialData: DashboardPayload | null;
  initialError?: string | null;
}) {
  const [data, setData] = useState<DashboardPayload | null>(initialData);
  const [error, setError] = useState<string | null>(initialError);
  const [loading, setLoading] = useState(!initialData && !initialError);
  const [lowsProgress, setLowsProgress] = useState<LowsProgress | null>(null);
  const [priceStatus, setPriceStatus] = useState<PriceStatus>({
    phase: "checking",
    updatedAt: initialData?.meta.priceCacheUpdatedAt ?? null,
    latest: 0,
    total: 0,
    stale: false,
  });
  const runningRef = useRef(false);
  const pollRef = useRef<number | null>(null);
  const autoCheckedRef = useRef(false);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    try {
      const next = await fetchDashboard();
      setData(next);
      setError(null);
      return next;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
      return null;
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, []);

  const stopPoll = useCallback(() => {
    if (pollRef.current != null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  /** GET the refresh status. Returns null when the endpoint is unreachable. */
  const pollStatus = useCallback(async (): Promise<StatusBody | null> => {
    try {
      const res = await fetch("/api/refresh-prices");
      if (!res.ok) return null;
      const body = (await res.json()) as StatusBody;
      const running = Boolean(body.running);
      const latest = body.latest ?? 0;
      const total = body.total ?? 0;
      if (total > 0) setLowsProgress({ latest, total, running });
      setPriceStatus((prev) => ({
        // A finished run clears "running"; offline and error stay until the
        // next explicit refresh so their message is not wiped by a poll.
        phase: running
          ? "running"
          : prev.phase === "offline" || prev.phase === "error"
            ? prev.phase
            : "idle",
        updatedAt: body.priceCacheUpdatedAt ?? prev.updatedAt,
        latest,
        total,
        stale: body.weekFresh === false || (total > 0 && latest < total),
        message: prev.message,
      }));
      if (runningRef.current && !running) {
        runningRef.current = false;
        stopPoll();
        void load({ silent: true });
      } else if (running) {
        runningRef.current = true;
      }
      return body;
    } catch {
      return null;
    }
  }, [load, stopPoll]);

  const startPoll = useCallback(() => {
    if (pollRef.current != null) return;
    pollRef.current = window.setInterval(() => {
      void pollStatus();
    }, 4000);
  }, [pollStatus]);

  /** POST a refresh. Without `force` the server skips it when lows are fresh. */
  const refreshLows = useCallback(
    async (opts?: { force?: boolean }) => {
      const fail = (message: string) =>
        setPriceStatus((prev) => ({ ...prev, phase: "error", message }));
      try {
        const res = await fetch("/api/refresh-prices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ force: Boolean(opts?.force) }),
        });
        const body = (await res.json().catch(() => ({}))) as RefreshBody;
        if (!res.ok) {
          fail(body.error || `Price refresh failed (${res.status}).`);
          return;
        }
        const latest = body.latest ?? 0;
        const total = body.total ?? 0;
        const running = Boolean(body.started || body.alreadyRunning);
        if (total > 0) setLowsProgress({ latest, total, running });
        setPriceStatus((prev) => ({
          ...prev,
          phase: running ? "running" : body.offline ? "offline" : "idle",
          latest: total > 0 ? latest : prev.latest,
          total: total > 0 ? total : prev.total,
          message: undefined,
        }));
        if (running) {
          runningRef.current = true;
          startPoll();
        }
      } catch {
        fail("The price refresh endpoint could not be reached.");
      }
    },
    [startPoll],
  );

  useEffect(() => {
    if (initialData) return;
    let cancelled = false;
    void (async () => {
      try {
        const next = await fetchDashboard();
        if (cancelled) return;
        setData(next);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialData]);

  // Weekly auto-refresh: read the status first and only ask for a refresh when
  // the cache is stale, instead of POSTing on every page load.
  useEffect(() => {
    void (async () => {
      const status = await pollStatus();
      if (autoCheckedRef.current) {
        if (runningRef.current) startPoll();
        return;
      }
      autoCheckedRef.current = true;
      if (!status) {
        setPriceStatus((prev) => ({ ...prev, phase: "idle" }));
        return;
      }
      if (status.running) {
        startPoll();
        return;
      }
      const total = status.total ?? 0;
      const stale =
        status.weekFresh === false || (total > 0 && (status.latest ?? 0) < total);
      if (stale) await refreshLows();
    })();
    return () => stopPoll();
  }, [pollStatus, refreshLows, startPoll, stopPoll]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    const onDevRefresh = () => {
      void load({ silent: true });
    };
    window.addEventListener("steam-stats:dev-refresh", onDevRefresh);
    return () => {
      window.removeEventListener("steam-stats:dev-refresh", onDevRefresh);
    };
  }, [load]);

  const retry = useCallback(async () => {
    await load();
  }, [load]);

  if (loading && !data) {
    return (
      <>
        <header className="app-bar">
          <div className="app-bar-inner shell" data-wide="true">
            <AppBrand />
          </div>
        </header>
        <main id="main" tabIndex={-1} className="shell app-main" data-wide="true">
          <div className="loading-shelf" aria-busy="true" aria-live="polite">
            <p className="sr-only">Loading library and prices…</p>
            <div className="loading-bar" aria-hidden>
              <span className="skeleton-block" />
              <span className="skeleton-block" />
            </div>
            <ul className="shelf-grid" aria-hidden>
              {Array.from({ length: 18 }, (_, i) => (
                <li key={i} className="loading-card">
                  <span className="skeleton-block loading-card-art" />
                  <span className="skeleton-block loading-card-line" />
                  <span className="skeleton-block loading-card-line short" />
                </li>
              ))}
            </ul>
          </div>
        </main>
      </>
    );
  }

  if (error && !data) {
    // First run: nothing has been fetched yet. That is a setup step, not a failure.
    const noData = /no account data found/i.test(error);
    return (
      <>
        <header className="app-bar">
          <div className="app-bar-inner shell">
            <AppBrand />
          </div>
        </header>
        <main id="main" tabIndex={-1} className="shell app-main">
          {noData ? (
            <div className="state-block" role="status">
              <h2>No Steam data yet</h2>
              <p>
                Steam Stats reads your Account Data from files on this machine,
                and there are none yet. Run the launch script from the project
                folder: it opens Steam for you to sign in, saves your library
                and purchase history locally, then starts the dashboard.
              </p>
              <pre className="state-command">
                <code className="mono">npm run launch</code>
              </pre>
              <p>Nothing leaves this machine.</p>
              <Button type="button" variant="outline" onClick={() => void retry()}>
                <RefreshCwIcon data-icon="inline-start" />
                Check again
              </Button>
            </div>
          ) : (
            <div className="state-block state-block-error" role="alert">
              <h2>Couldn’t load the dashboard</h2>
              <p className="state-detail">{error}</p>
              <p>
                Steam Stats reads files that the launch script writes on this
                machine. Run it from the project folder to fetch or repair
                them, then retry.
              </p>
              <pre className="state-command">
                <code className="mono">npm run launch</code>
              </pre>
              <Button type="button" variant="outline" onClick={() => void retry()}>
                <RefreshCwIcon data-icon="inline-start" />
                Retry
              </Button>
            </div>
          )}
        </main>
      </>
    );
  }

  if (!data) return null;

  return (
    <DashboardView
      data={data}
      onRefresh={retry}
      lowsProgress={lowsProgress}
      onRefreshLows={refreshLows}
      priceStatus={priceStatus}
    />
  );
}
