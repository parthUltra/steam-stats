import { NextResponse } from "next/server";
import { buildDashboard } from "@/lib/analytics/dashboard";

export const dynamic = "force-dynamic";
/** Price refresh is background-only; dashboard is cache-read. */
export const maxDuration = 60;

export async function GET() {
  try {
    // Cache only — never hit Steam/ITAD/CheapShark on dashboard load.
    // Weekly / manual refresh runs via /api/refresh-prices in the background.
    const data = await buildDashboard({
      refreshPrices: false,
      priceLimit: 0,
    });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Failed to build dashboard",
      },
      { status: 500 },
    );
  }
}
