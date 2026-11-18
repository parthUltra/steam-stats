import { NextResponse } from "next/server";
import { buildDashboard } from "@/lib/analytics/dashboard";
import {
  NO_ACCOUNT_DATA_MESSAGE,
  NO_ACCOUNT_DATA_PREFIX,
} from "@/lib/data/load-local";
import { serverError } from "@/lib/http/errors";

export const dynamic = "force-dynamic";
/** Price refresh is background-only; dashboard is cache-read. */
export const maxDuration = 60;

export async function GET() {
  try {
    // Cache only — never hit Steam / IsThereAnyDeal on dashboard load.
    // Weekly / manual refresh runs via /api/refresh-prices in the background.
    // (Gift redemption URLs are already absent: computeDashboard never puts
    // one in the payload — that is the single guard, and it is tested.)
    return NextResponse.json(await buildDashboard());
  } catch (err) {
    // The one message the UI needs verbatim (first-run hint); it is a constant.
    const noData =
      err instanceof Error && err.message.startsWith(NO_ACCOUNT_DATA_PREFIX);
    return serverError(
      noData ? NO_ACCOUNT_DATA_MESSAGE : "Failed to build dashboard",
      err,
    );
  }
}
