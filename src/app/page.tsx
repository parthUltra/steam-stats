import { DashboardClient } from "@/components/DashboardClient";
import { buildDashboard } from "@/lib/analytics/dashboard";
import {
  NO_ACCOUNT_DATA_MESSAGE,
  NO_ACCOUNT_DATA_PREFIX,
} from "@/lib/data/load-local";

export const dynamic = "force-dynamic";

export default async function Home() {
  let initialData = null;
  let initialError: string | null = null;
  try {
    // Cache-only first paint; weekly store lows refresh runs in the background if stale.
    initialData = await buildDashboard();
  } catch (err) {
    // Fixed messages only: the real error can carry absolute paths. The detail
    // goes to the server log, as in /api/dashboard.
    console.error("[page] Failed to build dashboard:", err);
    initialError =
      err instanceof Error && err.message.startsWith(NO_ACCOUNT_DATA_PREFIX)
        ? NO_ACCOUNT_DATA_MESSAGE
        : "Failed to build dashboard";
  }

  return (
    <DashboardClient initialData={initialData} initialError={initialError} />
  );
}
