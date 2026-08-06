"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCwIcon } from "lucide-react";
import { DashboardView } from "@/components/DashboardView";
import type { DashboardPayload } from "@/lib/analytics/dashboard";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

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
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/dashboard${refresh ? "?refresh=1" : ""}`,
        { cache: "no-store" },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load");
      setData(json as DashboardPayload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
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
            onClick={() => void load(false)}
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
      refreshing={refreshing}
      onRefreshPrices={() => void load(true)}
    />
  );
}
