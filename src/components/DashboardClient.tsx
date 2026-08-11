"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCwIcon } from "lucide-react";
import { DashboardView } from "@/components/DashboardView";
import type { DashboardPayload } from "@/lib/analytics/dashboard";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export type LowsProgress = {
  latest: number;
  total: number;
  running: boolean;
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
  const runningRef = useRef(false);
  const pollRef = useRef<number | null>(null);

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

  const pollStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/refresh-prices");
      const body = (await res.json()) as {
        latest?: number;
        total?: number;
        running?: boolean;
      };
      const running = Boolean(body.running);
      const latest = body.latest ?? 0;
      const total = body.total ?? 0;
      if (total > 0) setLowsProgress({ latest, total, running });
      if (runningRef.current && !running) {
        runningRef.current = false;
        stopPoll();
        void load({ silent: true });
        return;
      }
      if (running) runningRef.current = true;
    } catch {
      // ignore
    }
  }, [load, stopPoll]);

  const startPoll = useCallback(() => {
    if (pollRef.current != null) return;
    pollRef.current = window.setInterval(() => {
      void pollStatus();
    }, 4000);
  }, [pollStatus]);

  const refreshLows = useCallback(
    async (opts?: { force?: boolean }) => {
      try {
        const res = await fetch("/api/refresh-prices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ force: Boolean(opts?.force) }),
        });
        const body = (await res.json()) as {
          latest?: number;
          total?: number;
          started?: boolean;
          alreadyRunning?: boolean;
        };
        const latest = body.latest ?? 0;
        const total = body.total ?? 0;
        const running = Boolean(body.started || body.alreadyRunning);
        if (total > 0) setLowsProgress({ latest, total, running });
        if (running) {
          runningRef.current = true;
          startPoll();
        }
      } catch {
        // bar still shows last known coverage
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

  useEffect(() => {
    void (async () => {
      await refreshLows();
      await pollStatus();
      if (runningRef.current) startPoll();
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
      <div className="flex flex-col gap-4 py-10" aria-busy="true">
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
        <p className="text-center text-sm text-muted-foreground">
          Loading library &amp; quotes…
        </p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <Alert variant="destructive" className="mt-8">
        <AlertTitle>Couldn’t load dashboard</AlertTitle>
        <AlertDescription className="flex flex-col gap-3">
          <span>{error}</span>
          <span className="text-muted-foreground">
            Refresh Steam data from the launch script, then retry.
          </span>
          <Button
            type="button"
            variant="outline"
            className="w-fit"
            onClick={() => void retry()}
          >
            <RefreshCwIcon data-icon="inline-start" />
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (!data) return null;

  return (
    <DashboardView
      data={data}
      onRefresh={retry}
      lowsProgress={lowsProgress}
      onRefreshLows={refreshLows}
    />
  );
}
