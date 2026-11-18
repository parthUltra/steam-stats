import { format } from "date-fns";
import { dateSortKey, formatDayOrNull } from "@/components/dates";

/**
 * One locale per currency, never the runtime default, so server and browser
 * print the same string and grouping matches the currency's home convention.
 */
function localeFor(currency: string) {
  return currency === "INR" ? "en-IN" : "en-US";
}

export function moneyFmt(n: number, currency: string) {
  try {
    return new Intl.NumberFormat(localeFor(currency), {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${currency} ${Math.round(n).toLocaleString("en-US")}`;
  }
}

export function moneyPerHourFmt(n: number, currency: string) {
  try {
    return new Intl.NumberFormat(localeFor(currency), {
      style: "currency",
      currency,
      minimumFractionDigits: n < 10 ? 2 : 0,
      maximumFractionDigits: n < 10 ? 2 : 0,
    }).format(n);
  } catch {
    return `${currency} ${n < 10 ? n.toFixed(2) : Math.round(n).toLocaleString("en-US")}`;
  }
}

/** Axis ticks: ₹6k, ₹1.5k, ₹800. */
export function moneyCompact(n: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      notation: "compact",
      maximumFractionDigits: 1,
    })
      .format(n)
      .replace("K", "k");
  } catch {
    return String(Math.round(n));
  }
}

/** The one day format on the Value tab: "17 Aug 2026". See `components/dates`. */
export function formatDay(input: number | string | null | undefined): string {
  return formatDayOrNull(input) ?? (typeof input === "string" ? input : "");
}

function monthDate(monthKey: string): Date | null {
  const [y, m] = monthKey.split("-").map(Number);
  if (!y || !m) return null;
  return new Date(y, m - 1, 1);
}

/** The one month format: "Aug 2026" from a "2026-08" key. */
export function formatMonth(monthKey: string): string {
  const d = monthDate(monthKey);
  return d ? format(d, "MMM yyyy") : monthKey;
}

/** Long month for accessible names: "August 2026". */
export function formatMonthLong(monthKey: string): string {
  const d = monthDate(monthKey);
  return d ? format(d, "MMMM yyyy") : monthKey;
}

export function sortTime(input: number | string | null | undefined): number {
  return dateSortKey(input);
}
