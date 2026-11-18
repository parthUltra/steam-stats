import { dayOfInstant, monthOfInstant } from "@/components/dates";

/** Formatting for the stats boards. Money always uses the detected currency. */

/**
 * One locale per currency, never the runtime default: server and browser print
 * the same string, and grouping follows the currency's home convention. Kept
 * in step with `components/value/format.ts`.
 */
function localeFor(currency: string): string {
  return currency === "INR" ? "en-IN" : "en-US";
}

export function money(n: number, currency: string): string {
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

/** Signed money for gaps: "+₹1,200" / "−₹711" / "₹0". */
export function moneySigned(n: number, currency: string): string {
  const rounded = Math.round(n);
  if (rounded === 0) return money(0, currency);
  return `${rounded > 0 ? "+" : "−"}${money(Math.abs(rounded), currency)}`;
}

/** Short money for axis ticks and grid cells: "₹6.7K". */
export function moneyCompact(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      notation: "compact",
      maximumFractionDigits: n >= 1000 && n < 10_000 ? 1 : 0,
    }).format(n);
  } catch {
    return `${currency} ${Math.round(n)}`;
  }
}

export function moneyPerHour(n: number, currency: string): string {
  try {
    return `${new Intl.NumberFormat(localeFor(currency), {
      style: "currency",
      currency,
      maximumFractionDigits: n < 10 ? 2 : 0,
    }).format(n)}/h`;
  } catch {
    return `${currency} ${n < 10 ? n.toFixed(2) : Math.round(n)}/h`;
  }
}

/** "686 h", "42.5 h", "35 min". */
export function hours(h: number): string {
  if (h <= 0) return "0 h";
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h >= 100) return `${Math.round(h).toLocaleString("en-US")} h`;
  return `${h.toFixed(1)} h`;
}

/** Whole percent; one decimal below 10% where rounding would hide it. */
export function pct(share: number): string {
  const value = share * 100;
  if (value > 0 && value < 0.05) return "<0.1%";
  if (value > 0 && value < 10 && Math.abs(value - Math.round(value)) >= 0.05) {
    return `${value.toFixed(1)}%`;
  }
  return `${Math.round(value)}%`;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function monthName(index: number): string {
  return MONTHS[index] ?? "";
}

/** "2023-06" → "Jun 2023" */
export function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  const name = MONTHS[Number(m) - 1];
  return name && y ? `${name} ${y}` : key;
}

/** Epoch ms → "17 Aug 2026", in the display time zone. */
export function dateLabel(ms: number): string {
  return dayOfInstant(ms) ?? "unknown date";
}

/** Epoch ms → "Aug 2026", in the display time zone. */
export function monthOfDate(ms: number): string {
  return monthOfInstant(ms) ?? "unknown";
}

/** Day spans in the unit a person would say: days, months, then years. */
export function span(days: number): string {
  if (days < 1) return "today";
  if (days < 90) {
    const d = Math.round(days);
    return `${d} day${d === 1 ? "" : "s"}`;
  }
  if (days < 730) {
    const m = Math.round(days / 30.44);
    return `${m} months`;
  }
  return `${(days / 365.25).toFixed(1)} years`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}
