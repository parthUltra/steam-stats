/**
 * Spawn Gmail sync as a separate Node process so headed browser isn’t trapped
 * inside the Next.js request lifecycle (timeouts / syncLock / Turbopack).
 */
import {
  isGmailSyncRunning,
  readGmailSyncStatus,
  type GmailSyncStatus,
} from "@/lib/gifts/sync-gmail-playwright";
import { spawnDetachedScript } from "@/lib/process/spawn-script";

export type StartGmailSyncResult = {
  started: boolean;
  alreadyRunning: boolean;
  status: GmailSyncStatus;
  error?: string;
};

export async function startGmailSyncProcess(): Promise<StartGmailSyncResult> {
  if (await isGmailSyncRunning()) {
    return {
      started: false,
      alreadyRunning: true,
      status: await readGmailSyncStatus(),
    };
  }

  const status = await readGmailSyncStatus();
  if (
    status.phase === "starting" ||
    status.phase === "awaiting_login" ||
    status.phase === "scraping"
  ) {
    // Stale phase without a live pid — allow restart
  }

  try {
    spawnDetachedScript("scripts/sync-gifts-gmail.ts");

    // Brief wait so status.json / pid get written
    await new Promise((r) => setTimeout(r, 600));
    return {
      started: true,
      alreadyRunning: false,
      status: await readGmailSyncStatus(),
    };
  } catch (err) {
    return {
      started: false,
      alreadyRunning: false,
      status: await readGmailSyncStatus(),
      error: err instanceof Error ? err.message : "Failed to start Gmail sync",
    };
  }
}
