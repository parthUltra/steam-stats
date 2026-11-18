/**
 * The one title normaliser. Pure string helpers only — safe to import from
 * client components.
 *
 * `normTitle` output is the price-cache key (src/lib/pricing/prices.ts uses
 * this function), so changing it orphans every cached quote.
 */
export function normTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/™|®/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Steam gift cards ("Digital Gift Card", "Steam Gift Card") — never a game. */
export function isGiftCardName(name: string): boolean {
  return /gift card/i.test(name);
}

/** Median of the values; null for an empty list. */
export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * True when what follows a shared title prefix marks a different game in the
 * series: " 2", " II", ": Episode 1", " - Part 2". "Portal" + " 2" is a sequel;
 * "The Witcher 2" + ": Assassins of Kings" is not.
 */
export function isSequelRemainder(rest: string): boolean {
  const r = rest.replace(/^[\s:+|–—-]+/, "").trim();
  if (!r) return false;
  // A number or a roman numeral as its own word
  if (/^(\d+|[ivx]+)\b/i.test(r)) return true;
  return /^(episode|part|chapter)\b/i.test(r);
}
