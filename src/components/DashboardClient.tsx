"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCwIcon } from "lucide-react";
import { DashboardView } from "@/components/DashboardView";
import type { DashboardPayload } from "@/lib/analytics/dashboard";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

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

  useEffect(() => {
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
  }, []);

  // Weekly store lows: start a one-shot refresh only if stored data is stale (>7 days)
  useEffect(() => {
    void fetch("/api/refresh-prices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }).catch(() => undefined);
  }, []);

  // Dev: refresh data when files change (HMR) or the tab is focused.
  // Also poll slowly so background price updates show up without a hard reload.
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;

    const onDevRefresh = () => {
      void load({ silent: true });
    };
    const onFocus = () => {
      void load({ silent: true });
    };
    window.addEventListener("steam-stats:dev-refresh", onDevRefresh);
    window.addEventListener("focus", onFocus);
    const id = window.setInterval(() => {
      void load({ silent: true });
    }, 8_000);
    return () => {
      window.removeEventListener("steam-stats:dev-refresh", onDevRefresh);
      window.removeEventListener("focus", onFocus);
      window.clearInterval(id);
    };
  }, [load]);

  const retry = useCallback(async () => {
    await load();
  }, [load]);

  if (loading && !data) {
    return (
      <div className="flex flex-col gap-4 py-10">
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
        <p className="text-center text-sm text-muted-foreground">
          Loading Account Data & market quotes…
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
            Run{" "}
            <code className="font-mono text-primary">
              npm run fetch:account-data
            </code>{" "}
            then{" "}
            <code className="font-mono text-primary">
              npm run parse:account-data
            </code>
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

  return <DashboardView data={data} onRefresh={retry} />;
}
