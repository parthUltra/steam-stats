import { NextResponse } from "next/server";
import {
  isValidItadApiKey,
  resolveItadApiKey,
  saveItadCredentials,
} from "@/lib/pricing/itad-credentials";
import { serverError } from "@/lib/http/errors";
import { rejectCrossOrigin } from "@/lib/http/same-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ITAD_APPS_URL = "https://isthereanydeal.com/apps/";

/** GET — whether a key is stored locally (never returns the key). */
export async function GET() {
  const key = await resolveItadApiKey();
  return NextResponse.json({
    connected: Boolean(key),
    appsUrl: ITAD_APPS_URL,
  });
}

/**
 * POST — save a manually pasted ITAD API key immediately (no refresh wait).
 * Body: { apiKey: string }
 * Client should start /api/refresh-prices after a successful save.
 *
 * The key is stored only in data/itad-credentials.json (owner-only). It is not
 * written to .env.local and not copied into process.env.
 */
export async function POST(req: Request) {
  const denied = rejectCrossOrigin(req);
  if (denied) return denied;
  try {
    const body = (await req.json().catch(() => null)) as {
      apiKey?: unknown;
    } | null;
    const raw = body?.apiKey;
    // Surrounding spaces from a paste are fine; anything else must match exactly.
    const apiKey = typeof raw === "string" ? raw.replace(/^ +| +$/g, "") : "";
    if (!isValidItadApiKey(apiKey)) {
      return NextResponse.json(
        { ok: false, error: "Paste a valid IsThereAnyDeal API key." },
        { status: 400 },
      );
    }

    await saveItadCredentials(apiKey, "steam-stats");

    return NextResponse.json({
      ok: true,
      connected: true,
      message: "Key saved.",
    });
  } catch (err) {
    return serverError("Failed to save API key", err, { ok: false });
  }
}
