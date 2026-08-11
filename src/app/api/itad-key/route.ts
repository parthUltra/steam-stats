import { NextResponse } from "next/server";
import {
  resolveItadApiKey,
  saveItadCredentials,
} from "@/lib/pricing/itad-credentials";
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
 */
export async function POST(req: Request) {
  const denied = rejectCrossOrigin(req);
  if (denied) return denied;
  try {
    const body = (await req.json().catch(() => ({}))) as {
      apiKey?: string;
    };
    const apiKey = body.apiKey?.trim() ?? "";
    if (apiKey.length < 16) {
      return NextResponse.json(
        { ok: false, error: "Paste a valid IsThereAnyDeal API key." },
        { status: 400 },
      );
    }

    await saveItadCredentials(apiKey, "steam-stats");
    process.env.ISTHEREANYDEAL_API_KEY = apiKey;

    return NextResponse.json({
      ok: true,
      connected: true,
      message: "Key saved.",
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Failed to save API key",
      },
      { status: 500 },
    );
  }
}
