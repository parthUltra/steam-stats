/**
 * The dashboard payload: the contract between the analytics core, the stats
 * modules and the UI. Declared explicitly (not inferred from the builder) so an
 * analytics edit cannot silently change what the UI receives.
 *
 * Rule: adding a field is free; removing or renaming one needs a heads-up to
 * the UI lane. `tsc --noEmit` is the enforcement.
 */
import type { PlaytimeAnalytics } from "@/lib/account-data";
import type { CostPerHourAnalytics } from "@/lib/analytics/cost-per-hour";
import type { SpendingAnalytics } from "@/lib/analytics/spending";
import type { LibraryValuation } from "@/lib/analytics/valuation";
import type { DataIssue } from "@/lib/data/data-issues";
import type {
  AccountSourceId,
  AccountSourceState,
  LocalAccountBundle,
} from "@/lib/data/load-local";
import type { ReceivedGiftRecord } from "@/lib/gifts/received-store";
import type { StoreRegion } from "@/lib/pricing/store-region";
import type { StatsPayload } from "@/lib/stats";

/** appId (as string) → image URLs. No cache bookkeeping reaches the client. */
export type ArtworkMap = Record<
  string,
  { library: string; header: string; capsule: string }
>;

export type MailGiftSummary = {
  title: string;
  fromPersona: string | null;
  receivedAt: string | null;
  giftUrl: string | null;
  subject: string | null;
  source: ReceivedGiftRecord["source"];
  importedAt: ReceivedGiftRecord["importedAt"];
};

export type DashboardMeta = {
  source: LocalAccountBundle["source"];
  purchaseRows: number;
  licenseRows: number;
  priceCacheUpdatedAt: string | null;
  titlesForPricing: number;
  /**
   * @deprecated Always false. No Steam Web API key is read or sent anywhere
   * (the library comes from the session token). Kept so older clients compile.
   */
  hasSteamApiKey: boolean;
  hasItadApiKey: boolean;
  storeCountry: string;
  storeCurrency: string;
  storeRegionLabel: string;
  storeRegionSource: StoreRegion["source"];
  libraryGameCount: number;
  mailGiftsLastSyncedAt: string | null;
  mailGiftsCount: number;
  mailGifts: MailGiftSummary[];
  /**
   * Why each Account Data source has the rows it has (ok / partial /
   * login-required / unrecognized / missing). Licences carry
   * `pagination: { shown, total }`. Null for a hand-built bundle.
   */
  sourceStatus: Record<AccountSourceId, AccountSourceState> | null;
  /** When the playtime snapshot was fetched from Steam (ISO); null if unknown. */
  playedFetchedAt: string | null;
  /** When the account-spend page was fetched (ISO); null if unknown. */
  accountSpendFetchedAt: string | null;
  /**
   * True when a parsed source has status `unknown`: the files in
   * samples/parsed were written by an older version. Fix: run
   * `npm run parse:account-data`.
   */
  needsReparse: boolean;
  /** Unreadable cache files — the dashboard rendered without them. */
  dataIssues: DataIssue[];
  /**
   * Owned (non-family) library titles with no licence, purchase or gift
   * record — usually a sign the licence list or purchase history is incomplete.
   */
  ownedWithoutRecordCount: number;
};

export type { DataIssue } from "@/lib/data/data-issues";

export type RecentPurchase = {
  date: string;
  items: string[];
  total: number | null;
  currency: string;
  type: string;
  refunded: boolean;
  discountPct: number | null;
};

/** `games` (playedPaid + unplayedPaid combined) is not sent to the client. */
export type CostPerHourPayload = Omit<CostPerHourAnalytics, "games">;

export type DashboardPayload = {
  meta: DashboardMeta;
  playtime: PlaytimeAnalytics;
  spending: SpendingAnalytics;
  valuation: LibraryValuation;
  costPerHour: CostPerHourPayload;
  artwork: ArtworkMap;
  recentPurchases: RecentPurchase[];
  stats: StatsPayload;
};
