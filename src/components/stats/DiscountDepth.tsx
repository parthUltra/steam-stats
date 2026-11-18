import type { DiscountDepthStat } from "@/lib/stats";
import { money, pct, plural } from "./format";

const BIN_LABEL: Record<string, string> = {
  full: "Full price",
  "1-25": "1–25%",
  "26-50": "26–50%",
  "51-75": "51–75%",
  "76-100": "76%+",
};

/**
 * Discount depth as a five-bin strip for the foot of the Spend over time
 * board: one sentence, then a small histogram with every bar labelled.
 */
export function DiscountDepth({
  stat,
  currency,
}: {
  stat: DiscountDepthStat | null;
  currency: string;
}) {
  if (!stat) return null;
  const max = Math.max(...stat.bins.map((b) => b.count), 1);
  const takeaway =
    stat.discountedCount > 0
      ? `${stat.discountedCount} of ${plural(stat.purchaseCount, "purchase")} discounted, typically by ${Math.round(stat.medianDiscountPct ?? 0)}%. Overall you paid ${pct(stat.paidShareOfList)} of checkout list price. Counted per checkout.`
      : `All ${plural(stat.purchaseCount, "purchase")} were at full price.`;

  return (
    <div className="v-discount">
      <div>
        <h4>Discount depth</h4>
        <p>{takeaway}</p>
      </div>
      <ol
        className="v-discount-bins"
        aria-label="Purchases by discount depth, counted per checkout"
      >
        {stat.bins.map((b) => (
          <li
            key={b.id}
            title={b.count > 0 ? `${money(b.paid, currency)} paid` : undefined}
          >
            <span className="mono v-discount-count">{b.count}</span>
            <span className="v-discount-bar" aria-hidden>
              <span style={{ height: `${(b.count / max) * 100}%` }} />
            </span>
            <span className="v-discount-label">{BIN_LABEL[b.id]}</span>
            <span className="sr-only">
              {b.count === 1 ? " purchase" : " purchases"}
              {b.count > 0 ? `, ${money(b.paid, currency)} paid` : ""}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
