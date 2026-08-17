"use client";

import { useCallback, useEffect, useState } from "react";

export function useGmailSync(
  onRefresh?: () => Promise<void> | void,
  onRefreshLows?: (opts?: { force?: boolean }) => Promise<void> | void,
) {
  const [gmailWizardOpen, setGmailWizardOpen] = useState(false);
  const [mailSyncing, setMailSyncing] = useState(false);
  const [mailSyncError, setMailSyncError] = useState<string | null>(null);
  const [mailSyncStatus, setMailSyncStatus] = useState<string | null>(null);

  const syncGmail = useCallback(async () => {
    setGmailWizardOpen(false);
    setMailSyncing(true);
    setMailSyncError(null);
    setMailSyncStatus(
      "Opening a separate browser window for Gmail — your other windows stay open.",
    );
    try {
      const res = await fetch("/api/gifts-received", { method: "POST" });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        message?: string;
      };
      if (!res.ok || json.ok === false) {
        throw new Error(json.error || "Gmail sync failed to start");
      }
      if (json.message) setMailSyncStatus(json.message);

      const deadline = Date.now() + 12 * 60 * 1000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2000));
        const poll = await fetch("/api/gifts-received");
        const body = (await poll.json()) as {
          sync?: {
            phase?: string;
            running?: boolean;
            message?: string;
            error?: string;
            added?: number;
            total?: number;
          };
        };
        const sync = body.sync;
        if (sync?.message) setMailSyncStatus(sync.message);

        if (sync?.phase === "done") {
          const added = sync.added ?? 0;
          const total = sync.total ?? 0;
          setMailSyncStatus(
            added > 0
              ? `Added ${added} · ${total} total`
              : total > 0
                ? `Up to date · ${total} gifts`
                : "No new gifts found",
          );
          if (total > 0) {
            await onRefreshLows?.();
          }
          await onRefresh?.();
          return;
        }
        if (sync?.phase === "error") {
          throw new Error(sync.error || sync.message || "Gmail sync failed");
        }
        if (
          !sync?.running &&
          sync?.phase &&
          sync.phase !== "starting" &&
          sync.phase !== "awaiting_login" &&
          sync.phase !== "scraping" &&
          sync.phase === "idle"
        ) {
          throw new Error("Gmail sync did not start. Try again.");
        }
      }
      throw new Error("Timed out waiting for Gmail sync to finish.");
    } catch (err) {
      setMailSyncError(err instanceof Error ? err.message : "Gmail sync failed");
      setMailSyncStatus(null);
    } finally {
      setMailSyncing(false);
    }
  }, [onRefresh, onRefreshLows]);

  useEffect(() => {
    if (mailSyncing || mailSyncError || !mailSyncStatus) return;
    const t = window.setTimeout(() => setMailSyncStatus(null), 4000);
    return () => window.clearTimeout(t);
  }, [mailSyncing, mailSyncError, mailSyncStatus]);

  return {
    gmailWizardOpen,
    setGmailWizardOpen,
    mailSyncing,
    mailSyncError,
    mailSyncStatus,
    syncGmail,
  };
}

export type GmailSyncChrome = ReturnType<typeof useGmailSync>;
