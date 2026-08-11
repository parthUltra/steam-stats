"use client";

import { useCallback, useEffect, useState } from "react";

export function useItadKey(
  hasKey: boolean,
  onRefresh?: () => Promise<void> | void,
  onRefreshLows?: (opts?: { force?: boolean }) => Promise<void> | void,
) {
  const [itadConnected, setItadConnected] = useState(hasKey);
  const [itadStep, setItadStep] = useState<"explain" | "paste" | null>(null);
  const [itadKeyDraft, setItadKeyDraft] = useState("");
  const [itadSaving, setItadSaving] = useState(false);
  const [itadError, setItadError] = useState<string | null>(null);
  const [itadStatus, setItadStatus] = useState<string | null>(null);
  const [lowsRefreshing, setLowsRefreshing] = useState(false);

  useEffect(() => {
    setItadConnected(hasKey);
  }, [hasKey]);

  const openItadExplain = useCallback(() => {
    setItadError(null);
    setItadStatus(null);
    setItadKeyDraft("");
    setItadStep("explain");
  }, []);

  const continueToItadApps = useCallback(() => {
    window.open(
      "https://isthereanydeal.com/apps/",
      "_blank",
      "noopener,noreferrer",
    );
    setItadStep("paste");
  }, []);

  const refreshLowsNow = useCallback(async () => {
    setLowsRefreshing(true);
    setItadError(null);
    setItadStatus("Refreshing lows…");
    try {
      await onRefreshLows?.({ force: true });
      setItadStatus("Refresh started — progress updates below.");
    } catch (err) {
      setItadError(
        err instanceof Error ? err.message : "Could not refresh lows",
      );
      setItadStatus(null);
    } finally {
      window.setTimeout(() => setLowsRefreshing(false), 1200);
    }
  }, [onRefreshLows]);

  const saveItadKey = useCallback(async () => {
    setItadSaving(true);
    setItadError(null);
    try {
      const res = await fetch("/api/itad-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: itadKeyDraft }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        message?: string;
      };
      if (!res.ok || json.ok === false) {
        throw new Error(json.error || "Could not save API key");
      }
      setItadConnected(true);
      setItadStep(null);
      setItadKeyDraft("");
      setItadSaving(false);
      setItadStatus(json.message || "Key saved.");
      void onRefresh?.();
      void onRefreshLows?.({ force: true });
    } catch (err) {
      setItadError(err instanceof Error ? err.message : "Could not save API key");
      setItadStatus(null);
      setItadSaving(false);
    }
  }, [itadKeyDraft, onRefresh, onRefreshLows]);

  return {
    itadConnected,
    itadStep,
    setItadStep,
    itadKeyDraft,
    setItadKeyDraft,
    itadSaving,
    itadError,
    setItadError,
    itadStatus,
    lowsRefreshing,
    openItadExplain,
    continueToItadApps,
    refreshLowsNow,
    saveItadKey,
  };
}

export type ItadKeyChrome = ReturnType<typeof useItadKey>;
