import { titlesSoftMatch } from "@/lib/analytics/acquisition";

export function giftTitlesMatch(a: string, b: string): boolean {
  const loose = (t: string) =>
    t
      .toLowerCase()
      .replace(/™|®/g, "")
      .replace(/[-–—:!?.]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  return (
    loose(a) === loose(b) ||
    titlesSoftMatch(a, b) ||
    a.toLowerCase() === b.toLowerCase()
  );
}
