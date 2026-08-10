import { DashboardClient } from "@/components/DashboardClient";
import { buildDashboard } from "@/lib/analytics/dashboard";

export const dynamic = "force-dynamic";

export default async function Home() {
  let initialData = null;
  let initialError: string | null = null;
  try {
    // Cache-only first paint; weekly store lows refresh runs in the background if stale.
    initialData = await buildDashboard({
      refreshPrices: false,
      priceLimit: 0,
    });
  } catch (err) {
    initialError = err instanceof Error ? err.message : "Failed to load";
  }

  return (
    <DashboardClient initialData={initialData} initialError={initialError} />
  );
}
