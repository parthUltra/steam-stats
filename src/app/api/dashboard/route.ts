import { NextResponse } from "next/server";
import { buildDashboard } from "@/lib/analytics/dashboard";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const refresh = searchParams.get("refresh") === "1";
  try {
    const data = await buildDashboard({
      refreshPrices: refresh,
      priceLimit: refresh ? 80 : 60,
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
