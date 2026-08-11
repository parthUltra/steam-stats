import { NextResponse } from "next/server";
import {
  clearReceivedGifts,
  loadReceivedGifts,
} from "@/lib/gifts/received-store";
import { startGmailSyncProcess } from "@/lib/gifts/start-gmail-sync";
import {
  isGmailSyncRunning,
  readGmailSyncStatus,
} from "@/lib/gifts/sync-gmail-playwright";
import { rejectCrossOrigin } from "@/lib/http/same-origin";

export const dynamic = "force-dynamic";

export async function GET() {
  const [store, status, running] = await Promise.all([
    loadReceivedGifts(),
    readGmailSyncStatus(),
    isGmailSyncRunning(),
  ]);
  return NextResponse.json({
    ...store,
    sync: { ...status, running },
  });
}

export async function DELETE(req: Request) {
  const denied = rejectCrossOrigin(req);
  if (denied) return denied;
  const store = await clearReceivedGifts();
  return NextResponse.json(store);
}

/**
 * Starts Gmail sync in a detached browser process and returns immediately.
 * Poll GET until sync.phase is done|error (or sync.running is false).
 */
export async function POST(req: Request) {
  const denied = rejectCrossOrigin(req);
  if (denied) return denied;
  try {
    const result = await startGmailSyncProcess();
    if (result.error && !result.started && !result.alreadyRunning) {
      return NextResponse.json(
        { ok: false, error: result.error, ...result },
        { status: 500 },
      );
    }
    return NextResponse.json({
      ok: true,
      ...result,
      message: result.alreadyRunning
        ? "Gmail sync already running — finish in the separate browser window."
        : "Opened a separate browser for Gmail — your other windows stay open. This page updates when sync finishes.",
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Gmail sync failed",
      },
      { status: 500 },
    );
  }
}
