import { format, isValid, parse, parseISO } from "date-fns";

/**
 * Every date on screen goes through this module, so the server render and the
 * browser can never print different days.
 *
 * Two kinds of value reach the UI:
 *
 * - Calendar dates ("30 Jun, 2023", "2023-06-30"): a day with no time. They
 *   are parsed and printed in the same runtime, so the time zone cancels out.
 * - Instants (epoch ms, ISO timestamps with a time): the day depends on a time
 *   zone. One zone is chosen once, the zone of the process that rendered the
 *   page, and used on both sides. The server stamps it into the HTML
 *   (`DISPLAY_TZ_ATTR`); the browser reads it back before its first render.
 *   Date-only values the server stored as "local midnight" therefore print as
 *   the day the server meant.
 */
export const DISPLAY_TZ_ATTR = "data-display-tz";

let zone: string | null = null;

export function displayTimeZone(): string {
  if (zone) return zone;
  let stamped: string | null = null;
  if (typeof document !== "undefined") {
    stamped =
      document.querySelector(`[${DISPLAY_TZ_ATTR}]`)?.getAttribute(DISPLAY_TZ_ATTR) ??
      null;
  }
  let own = "UTC";
  try {
    own = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    // keep UTC
  }
  zone = stamped || own;
  return zone;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const partsCache = new Map<string, Intl.DateTimeFormat>();

/** Year, month (0–11) and day of an instant in the display time zone. */
function ymd(ms: number): { y: number; m: number; d: number } | null {
  if (!Number.isFinite(ms)) return null;
  const tz = displayTimeZone();
  let fmt = partsCache.get(tz);
  if (!fmt) {
    try {
      fmt = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        year: "numeric",
        month: "numeric",
        day: "numeric",
      });
    } catch {
      fmt = new Intl.DateTimeFormat("en-US", {
        timeZone: "UTC",
        year: "numeric",
        month: "numeric",
        day: "numeric",
      });
    }
    partsCache.set(tz, fmt);
  }
  const out = { y: 0, m: 0, d: 0 };
  for (const part of fmt.formatToParts(new Date(ms))) {
    if (part.type === "year") out.y = Number(part.value);
    else if (part.type === "month") out.m = Number(part.value) - 1;
    else if (part.type === "day") out.d = Number(part.value);
  }
  return out.y ? out : null;
}

/** Instant → "17 Aug 2026". */
export function dayOfInstant(ms: number | null | undefined): string | null {
  const p = ms == null ? null : ymd(ms);
  return p ? `${p.d} ${MONTHS[p.m]} ${p.y}` : null;
}

/** Instant → "Aug 2026". */
export function monthOfInstant(ms: number | null | undefined): string | null {
  const p = ms == null ? null : ymd(ms);
  return p ? `${MONTHS[p.m]} ${p.y}` : null;
}

const CALENDAR_FORMATS = ["d MMM, yyyy", "MMM d, yyyy", "d MMM yyyy", "yyyy-MM-dd"];

/** A calendar date string as a local Date; null when it is not one. */
export function parseCalendarDate(input: string): Date | null {
  const text = input.trim();
  for (const f of CALENDAR_FORMATS) {
    const d = parse(text, f, new Date(2000, 0, 1));
    if (isValid(d)) return d;
  }
  return null;
}

/** True for ISO strings that carry a time of day: those are instants. */
function isTimestamp(input: string): boolean {
  return /\dT\d/.test(input);
}

/**
 * The one day format, "17 Aug 2026", for any date the payload carries: epoch
 * ms, ISO timestamps, ISO dates and Steam's "30 Jun, 2023". Null when the
 * value is missing or unreadable.
 */
export function formatDayOrNull(
  input: number | string | null | undefined,
): string | null {
  if (input == null || input === "") return null;
  if (typeof input === "number") return dayOfInstant(input);
  if (isTimestamp(input)) {
    const d = parseISO(input);
    return isValid(d) ? dayOfInstant(d.getTime()) : null;
  }
  const d = parseCalendarDate(input);
  return d ? format(d, "d MMM yyyy") : null;
}

/** A sortable number for any date value; 0 when unreadable. */
export function dateSortKey(input: number | string | null | undefined): number {
  if (input == null || input === "") return 0;
  if (typeof input === "number") return Number.isFinite(input) ? input : 0;
  if (isTimestamp(input)) {
    const d = parseISO(input);
    return isValid(d) ? d.getTime() : 0;
  }
  return parseCalendarDate(input)?.getTime() ?? 0;
}
