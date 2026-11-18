import type { PurchaseHistoryRow } from "@/lib/account-data";
import { normTitle } from "@/lib/analytics/acquisition";
import {
  isTrackableGamePurchase,
  parseSteamDate,
} from "@/lib/analytics/spending";

export const DAY_MS = 86_400_000;

/** Same threshold the cost-per-hour board uses for "played". */
export const PLAYED_HOURS = 0.5;

export function sum(values: readonly number[]): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

export function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** "2023-06" in local time, matching how spending buckets months. */
export function monthKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Every month key from `from` to `to` inclusive (both "YYYY-MM"). */
export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  if (![y, m, ty, tm].every(Number.isFinite)) return out;
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/**
 * Earliest purchase date (epoch ms) per exact normalised title, from library
 * purchases only (refunds, gifts sent, wallet and market rows are excluded).
 * Exact names only: fuzzy title matching belongs to the analytics core.
 */
export function purchaseDateByTitle(
  purchases: readonly PurchaseHistoryRow[],
): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of purchases) {
    if (!isTrackableGamePurchase(row)) continue;
    const at = parseSteamDate(row.dateText)?.getTime();
    if (at == null) continue;
    const names = row.lineItems?.length
      ? row.lineItems.map((l) => l.name)
      : row.items;
    for (const name of names) {
      const key = normTitle(name);
      if (!key) continue;
      const prev = out.get(key);
      if (prev == null || at < prev) out.set(key, at);
    }
  }
  return out;
}
