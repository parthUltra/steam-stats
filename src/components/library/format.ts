import { formatDayOrNull } from "@/components/dates";
import { formatPlayHours } from "@/lib/steam/artwork";

/** App-wide day format: "17 Aug 2026". */
export function formatDay(value: number | string | null | undefined): string | null {
  return formatDayOrNull(value);
}

/** Hours as shown on the shelf: "687", "97.6", "0.5"; thousands grouped. */
export function formatHours(h: number): string {
  if (h >= 1000) return Math.round(h).toLocaleString("en-US");
  return formatPlayHours(h);
}

export function formatMoney(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${currency} ${Math.round(n).toLocaleString("en-US")}`;
  }
}

export function formatMoneyPerHour(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency,
      maximumFractionDigits: n < 10 ? 2 : 0,
    }).format(n);
  } catch {
    return `${currency} ${n < 10 ? n.toFixed(2) : Math.round(n)}`;
  }
}
