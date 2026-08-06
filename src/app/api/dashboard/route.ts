import { NextResponse } from "next/server";
import { buildDashboard } from "@/lib/analytics/dashboard";

export const dynamic = "force-dynamic";
/** Price refresh uses async pool (concurrency 3) + Steam rate limiter; usually finishes under this budget. */
export const maxDuration = 120;

export async function GET() {
  try {
    // Tops up missing/stale quotes (24h TTL); force via CLI: npm run refresh:prices
    const data = await buildDashboard({
      refreshPrices: false,
      priceLimit: 80,
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
