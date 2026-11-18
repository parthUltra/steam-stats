import { isTrackableGamePurchase, moneyOf } from "@/lib/analytics/spending";
import type { StatsInput } from "./types";
import { median } from "./util";

export type DiscountBin = {
  id: "full" | "1-25" | "26-50" | "51-75" | "76-100";
  count: number;
  paid: number;
};

export type DiscountDepthStat = {
  /** Library purchases with a positive amount (refunds and gifts excluded). */
  purchaseCount: number;
  discountedCount: number;
  bins: DiscountBin[];
  /** Median discount among discounted purchases, in percent; null if none. */
  medianDiscountPct: number | null;
  paidTotal: number;
  /** Checkout list price where Steam recorded one, else the amount paid. */
  listTotal: number;
  /** paidTotal / listTotal, 0–1. */
  paidShareOfList: number;
};

const BIN_IDS: DiscountBin["id"][] = ["full", "1-25", "26-50", "51-75", "76-100"];

function binFor(depth: number): DiscountBin["id"] {
  if (depth <= 0) return "full";
  if (depth <= 25) return "1-25";
  if (depth <= 50) return "26-50";
  if (depth <= 75) return "51-75";
  return "76-100";
}

/**
 * Works per checkout, not per game: a multi-item cart carries one cart-level
 * discount, so splitting it per line would claim precision the data lacks.
 */
export function discountDepth(input: StatsInput): DiscountDepthStat | null {
  const rows = input.purchases.filter(
    (r) => isTrackableGamePurchase(r) && moneyOf(r) > 0,
  );
  if (!rows.length) return null;

  const bins = new Map<DiscountBin["id"], DiscountBin>(
    BIN_IDS.map((id) => [id, { id, count: 0, paid: 0 }]),
  );
  const depths: number[] = [];
  let paidTotal = 0;
  let listTotal = 0;
  for (const row of rows) {
    const paid = moneyOf(row);
    const depth = Math.min(100, Math.abs(row.discountPct ?? 0));
    const bin = bins.get(binFor(depth))!;
    bin.count += 1;
    bin.paid += paid;
    if (depth > 0) depths.push(depth);
    paidTotal += paid;
    const list = row.originalPrice?.amount;
    // A list price below what was paid is a parse artefact, not a discount.
    listTotal += list != null && list > paid ? list : paid;
  }

  return {
    purchaseCount: rows.length,
    discountedCount: depths.length,
    bins: BIN_IDS.map((id) => bins.get(id)!),
    medianDiscountPct: median(depths),
    paidTotal,
    listTotal,
    paidShareOfList: listTotal > 0 ? paidTotal / listTotal : 1,
  };
}
