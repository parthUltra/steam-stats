import type {
  LicenseRow,
  PlayedGame,
  PurchaseHistoryRow,
} from "@/lib/account-data";
import type { CostPerHourAnalytics } from "@/lib/analytics/cost-per-hour";
import type { SpendingAnalytics } from "@/lib/analytics/spending";
import type { LibraryValuation } from "@/lib/analytics/valuation";

/** Everything a stat may read. Stats are pure: no I/O, no clock. */
export type StatsInput = Readonly<{
  playedGames: readonly PlayedGame[];
  purchases: readonly PurchaseHistoryRow[];
  licenses: readonly LicenseRow[];
  spending: SpendingAnalytics;
  valuation: LibraryValuation;
  costPerHour: CostPerHourAnalytics;
  currency: string;
  /** Snapshot time (epoch ms) — when playtime was fetched, not the wall clock. */
  now: number;
  /**
   * Games gifted to the owner (Steam gift licences and imported gift e-mails)
   * with the date they arrived (epoch ms; null when unknown).
   */
  receivedGifts?: readonly { title: string; receivedAt: number | null }[];
}>;

export type StatTab = "library" | "value";
