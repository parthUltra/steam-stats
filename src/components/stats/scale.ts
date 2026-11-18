/** Log-axis helpers: 1–2–5 ticks and positions, shared by the value map. */

const STEPS = [1, 2, 5];

/** 1–2–5 values from the last one ≤ min to the first one ≥ max. */
export function logTicks(min: number, max: number): number[] {
  if (!(min > 0) || !(max >= min)) return [];
  const out: number[] = [];
  let lower: number | null = null;
  const start = Math.floor(Math.log10(min)) - 1;
  const end = Math.ceil(Math.log10(max)) + 1;
  for (let exp = start; exp <= end; exp += 1) {
    for (const step of STEPS) {
      // toPrecision trims float noise such as 0.5000000000000001.
      const value = Number((step * 10 ** exp).toPrecision(1));
      if (value <= min) {
        lower = value;
        continue;
      }
      if (lower != null && !out.length) out.push(lower);
      out.push(value);
      if (value >= max) return out;
    }
  }
  return out;
}

/** Position of `value` between `min` and `max` on a log scale, 0–1. */
export function logPosition(value: number, min: number, max: number): number {
  if (!(value > 0) || !(min > 0) || max <= min) return 0;
  const p = (Math.log(value) - Math.log(min)) / (Math.log(max) - Math.log(min));
  return Math.max(0, Math.min(1, p));
}
