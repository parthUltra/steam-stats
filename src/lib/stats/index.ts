import { backlog, type BacklogStat } from "./backlog";
import { cohorts, type CohortsStat } from "./cohorts";
import { concentration, type ConcentrationStat } from "./concentration";
import { cumulativeSpend, type CumulativeSpendStat } from "./cumulative-spend";
import { discountDepth, type DiscountDepthStat } from "./discount-depth";
import { distribution, type DistributionStat } from "./distribution";
import { dormancy, type DormancyStat } from "./dormancy";
import { hoursBySource, type HoursBySourceStat } from "./hours-by-source";
import { libraryGrowth, type LibraryGrowthStat } from "./library-growth";
import { paidVsLow, type PaidVsLowStat } from "./paid-vs-low";
import { purchaseGrid, type PurchaseGridStat } from "./purchase-grid";
import type { StatsInput } from "./types";
import { valueMap, type ValueMapStat } from "./value-map";

export type { StatsInput, StatTab } from "./types";
export type {
  BacklogStat,
  CohortsStat,
  ConcentrationStat,
  CumulativeSpendStat,
  DiscountDepthStat,
  DistributionStat,
  DormancyStat,
  HoursBySourceStat,
  LibraryGrowthStat,
  PaidVsLowStat,
  PurchaseGridStat,
  ValueMapStat,
};

/** One key per stat; a stat is null when the data cannot support it. */
export type StatsPayload = {
  /** Snapshot time (epoch ms) every "as of" label refers to. */
  asOf: number;
  // Library tab
  concentration: ConcentrationStat | null;
  distribution: DistributionStat | null;
  dormancy: DormancyStat | null;
  backlog: BacklogStat | null;
  libraryGrowth: LibraryGrowthStat | null;
  hoursBySource: HoursBySourceStat | null;
  // Value tab
  valueMap: ValueMapStat | null;
  paidVsLow: PaidVsLowStat | null;
  cumulativeSpend: CumulativeSpendStat | null;
  discountDepth: DiscountDepthStat | null;
  cohorts: CohortsStat | null;
  purchaseGrid: PurchaseGridStat | null;
};

export function buildStats(input: StatsInput): StatsPayload {
  return {
    asOf: input.now,
    concentration: concentration(input),
    distribution: distribution(input),
    dormancy: dormancy(input),
    backlog: backlog(input),
    libraryGrowth: libraryGrowth(input),
    hoursBySource: hoursBySource(input),
    valueMap: valueMap(input),
    paidVsLow: paidVsLow(input),
    cumulativeSpend: cumulativeSpend(input),
    discountDepth: discountDepth(input),
    cohorts: cohorts(input),
    purchaseGrid: purchaseGrid(input),
  };
}
