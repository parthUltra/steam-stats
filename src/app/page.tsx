import { DashboardClient } from "@/components/DashboardClient";
import { buildDashboard } from "@/lib/analytics/dashboard";

export const dynamic = "force-dynamic";

export default async function Home() {
  let initialData = null;
  let initialError: string | null = null;
  try {
    // Cache-only first paint; client /api/dashboard tops up stale quotes.
    initialData = await buildDashboard({ refreshPrices: false, priceLimit: 0 });
  } catch (err) {
    initialError = err instanceof Error ? err.message : "Failed to load";
  }

  return (
    <DashboardClient initialData={initialData} initialError={initialError} />
  );
}
