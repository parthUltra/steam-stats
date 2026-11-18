"use client";

import { RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LowsProgress } from "@/components/DashboardClient";
import { formatDay } from "@/components/value/format";

/**
 * Store-low coverage and quote freshness in one calm line, with the single
 * refresh (or connect) control for the whole tab.
 */
export function LowsStatus({
  progress,
  quotesUpdatedAt,
  connected,
  refreshing,
  onRefresh,
  onConnect,
  status,
  error,
}: {
  progress?: LowsProgress | null;
  quotesUpdatedAt: string | null;
  connected: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onConnect: () => void;
  status: string | null;
  error: string | null;
}) {
  const total = progress?.total ?? 0;
  const latest = Math.max(0, Math.min(progress?.latest ?? 0, total));
  const complete = total > 0 && latest >= total;
  const coverage =
    total <= 0
      ? null
      : complete
        ? `Store lows fresh for all ${total} titles`
        : `Store lows fresh for ${latest} of ${total} titles`;

  return (
    <div className="v-lows">
      <div className="v-lows-text">
        {coverage ? (
          <span className="v-lows-coverage">
            {!complete ? (
              <span
                className="v-lows-meter"
                role="progressbar"
                aria-label="Titles with a store low fetched this week"
                aria-valuemin={0}
                aria-valuemax={total}
                aria-valuenow={latest}
                aria-valuetext={`${latest} of ${total} titles`}
              >
                <span style={{ width: `${(latest / total) * 100}%` }} />
              </span>
            ) : null}
            <span>
              {progress?.running && !complete ? "Refreshing. " : ""}
              {coverage}
            </span>
          </span>
        ) : null}
        <span>
          {quotesUpdatedAt
            ? `Quotes updated ${formatDay(quotesUpdatedAt)}`
            : "No market quotes yet"}
        </span>
        <span className="v-lows-live" aria-live="polite">
          {error ? (
            <span className="v-error">{error}</span>
          ) : status ? (
            status
          ) : null}
        </span>
      </div>
      {connected ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={refreshing}
          onClick={onRefresh}
        >
          <RefreshCwIcon
            data-icon="inline-start"
            className={refreshing ? "animate-spin" : undefined}
          />
          {refreshing ? "Refreshing…" : "Refresh lows"}
        </Button>
      ) : (
        <Button type="button" variant="outline" size="sm" onClick={onConnect}>
          Get store lows
        </Button>
      )}
    </div>
  );
}
