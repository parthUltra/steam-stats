import { DashboardClient } from "@/components/DashboardClient";
import { buildDashboard } from "@/lib/analytics/dashboard";

export const dynamic = "force-dynamic";

export default async function Home() {
  let initialData = null;
  let initialError: string | null = null;
  try {
    // Use cache only on first paint so the page loads fast; user can refresh prices.
    initialData = await buildDashboard({ refreshPrices: false, priceLimit: 0 });
  } catch (err) {
    initialError = err instanceof Error ? err.message : "Failed to load";
  }

  return (
    <DashboardClient initialData={initialData} initialError={initialError} />
  );
}
