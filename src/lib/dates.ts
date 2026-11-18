/**
 * Steam date labels → Date. Pure and dependency-free (no HTML parser), so it
 * can be imported from modules that are reachable from client components.
 */

/** Month names (short and long) in the languages Steam serves, → 0-based month. */
const MONTHS: Map<string, number> = (() => {
  const map = new Map<string, number>();
  const key = (name: string) =>
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ.]/g, "");
  // English first: on a clash the English reading wins.
  const locales =
    "en fr de es pt it nl pl ru tr sv da nb fi cs hu ro uk".split(" ");
  for (const locale of locales) {
    for (const style of ["short", "long"] as const) {
      const fmt = new Intl.DateTimeFormat(locale, { month: style, timeZone: "UTC" });
      for (let m = 0; m < 12; m++) {
        const k = key(fmt.format(new Date(Date.UTC(2024, m, 15))));
        if (k && !/^\d+$/.test(k) && !map.has(k)) map.set(k, m);
      }
    }
  }
  return map;
})();

function validDate(year: number, month: number, day: number): Date | null {
  const d = new Date(year, month, day);
  return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day
    ? d
    : null;
}

/**
 * Parse a date as Steam prints it: "11 Aug, 2026", "Aug 11, 2026",
 * "11. Aug. 2026", "2026-08-11", and the year-less "17 Aug" / "Aug 17" /
 * "Today" / "Yesterday" of the games page. Returns local midnight.
 *
 * A year-less label only means something relative to when the page was
 * fetched, so its year comes from `opts.now` (the snapshot's fetch time): the
 * latest such date not after it — which also puts "29 Feb" in a leap year.
 * Without `opts.now` a year-less label returns null. The wall clock is never
 * consulted: re-parsing an old snapshot later must not move its dates.
 */
export function parseSteamDate(
  text: string | null | undefined,
  opts?: { now?: Date | number | string | null },
): Date | null {
  if (!text) return null;
  const cleaned = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;

  const nowMs =
    opts?.now == null
      ? NaN
      : opts.now instanceof Date
        ? opts.now.getTime()
        : typeof opts.now === "number"
          ? opts.now
          : Date.parse(opts.now);
  const now = Number.isFinite(nowMs) ? new Date(nowMs) : null;

  if (cleaned === "today" || cleaned === "yesterday") {
    if (!now) return null;
    return new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - (cleaned === "yesterday" ? 1 : 0),
    );
  }

  const iso = cleaned.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:t|$| )/);
  if (iso) return validDate(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));

  let day: number | null = null;
  let month: number | null = null;
  let year: number | null = null;
  for (const tok of cleaned.split(" ")) {
    if (/^\d{4}$/.test(tok) && year == null) year = Number(tok);
    else if (/^\d{1,2}$/.test(tok) && day == null) day = Number(tok);
    else if (MONTHS.has(tok) && month == null) month = MONTHS.get(tok)!;
    else return null;
  }
  if (day == null || month == null) return null;
  if (year != null) return validDate(year, month, day);

  if (!now) return null;
  // Latest matching date that is not after the snapshot (one day of slack for
  // time zones). Looking back 8 years always reaches a leap year for 29 Feb.
  const limit = now.getTime() + 24 * 60 * 60 * 1000;
  for (let y = now.getFullYear(); y >= now.getFullYear() - 8; y--) {
    const d = validDate(y, month, day);
    if (d && d.getTime() <= limit) return d;
  }
  return null;
}

/** Local calendar date as "YYYY-MM-DD" (no time, no time-zone shift). */
export function isoLocalDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Stored label for an instant: its UTC calendar date, "YYYY-MM-DD". The epoch
 * value is the data; this text is only a stable, locale-independent label
 * (`toLocaleDateString()` would bake the fetching machine's locale into the
 * snapshot — "8/2/2026" vs "02/08/2026").
 */
export function isoUtcDate(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}
