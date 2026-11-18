import { NextResponse } from "next/server";
import {
  corruptFileIssue,
  loadOrReport,
  type DataIssue,
} from "@/lib/data/data-issues";
import { CorruptJsonFileError } from "@/lib/data/json-store";
import {
  clearReceivedGifts,
  loadReceivedGifts,
} from "@/lib/gifts/received-store";
import { startGmailSyncProcess } from "@/lib/gifts/start-gmail-sync";
import {
  isGmailSyncRunning,
  readGmailSyncStatus,
} from "@/lib/gifts/sync-gmail-playwright";
import { serverError } from "@/lib/http/errors";
import { rejectCrossOrigin } from "@/lib/http/same-origin";
import { isOffline } from "@/lib/runtime";

export const dynamic = "force-dynamic";

/** Sync status for the client: no process id. */
function publicStatus<T extends { pid?: number }>(status: T): Omit<T, "pid"> {
  const { pid: _pid, ...rest } = status;
  void _pid;
  return rest;
}

export async function GET() {
  const issues: DataIssue[] = [];
  const [store, status, running] = await Promise.all([
    loadOrReport(
      "received-gifts-unreadable",
      loadReceivedGifts,
      () => ({ updatedAt: "", lastMailSyncedAt: undefined, gifts: [] }),
      issues,
    ),
    readGmailSyncStatus(),
    isGmailSyncRunning(),
  ]);
  return NextResponse.json({
    updatedAt: store.updatedAt,
    lastMailSyncedAt: store.lastMailSyncedAt,
    // Gift redemption URLs and raw mail headers stay on disk; the UI needs neither.
    gifts: store.gifts.map((g) => ({
      title: g.title,
      fromPersona: g.fromPersona,
      receivedAt: g.receivedAt,
      source: g.source,
      importedAt: g.importedAt,
    })),
    sync: { ...publicStatus(status), running },
    // The gifts file exists but cannot be read; it was left untouched.
    ...(issues[0] ? { dataIssue: issues[0] } : {}),
  });
}

export async function DELETE(req: Request) {
  const denied = rejectCrossOrigin(req);
  if (denied) return denied;
  try {
    const store = await clearReceivedGifts();
    return NextResponse.json(store);
  } catch (err) {
    if (err instanceof CorruptJsonFileError) {
      // Never replace a file we cannot read: the owner restores or removes it.
      return NextResponse.json(
        {
          ok: false,
          error: "Gifts file is unreadable",
          dataIssue: await corruptFileIssue("received-gifts-unreadable", err),
        },
        { status: 409 },
      );
    }
    return serverError("Failed to clear gifts", err, { ok: false });
  }
}

/**
 * Starts Gmail sync in a detached browser process and returns immediately.
 * Poll GET until sync.phase is done|error (or sync.running is false).
 */
export async function POST(req: Request) {
  const denied = rejectCrossOrigin(req);
  if (denied) return denied;
  // The sync imports into the gifts file; an unreadable one is never replaced.
  const issues: DataIssue[] = [];
  await loadOrReport(
    "received-gifts-unreadable",
    loadReceivedGifts,
    () => null,
    issues,
  );
  if (issues[0]) {
    return NextResponse.json(
      { ok: false, error: "Gifts file is unreadable", dataIssue: issues[0] },
      { status: 409 },
    );
  }
  if (isOffline()) {
    return NextResponse.json({ ok: false, error: "offline" }, { status: 409 });
  }
  try {
    const result = await startGmailSyncProcess();
    const body = {
      started: result.started,
      alreadyRunning: result.alreadyRunning,
      status: publicStatus(result.status),
    };
    if (result.error && !result.started && !result.alreadyRunning) {
      return NextResponse.json(
        { ok: false, ...body, error: result.error },
        { status: 500 },
      );
    }
    return NextResponse.json({
      ok: true,
      ...body,
      message: result.alreadyRunning
        ? "Gmail sync already running — finish in the separate browser window."
        : "Opened a separate browser for Gmail — your other windows stay open. This page updates when sync finishes.",
    });
  } catch (err) {
    return serverError("Gmail sync failed", err, { ok: false });
  }
}
