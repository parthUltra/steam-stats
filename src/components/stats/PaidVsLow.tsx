import { ChevronDownIcon } from "lucide-react";
import type { PaidVsLowStat } from "@/lib/stats";
import { DataTable } from "./StatBoard";
import { money, moneySigned, pct, plural } from "./format";

const SHOW_ABOVE = 6;
const SHOW_BELOW = 6;

type Row = PaidVsLowStat["rows"][number];

function GapRow({ row, max, currency }: { row: Row; max: number; currency: string }) {
  const width = max > 0 ? (Math.abs(row.gap) / max) * 100 : 0;
  const above = row.gap > 0;
  return (
    <li className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-sm text-foreground">{row.title}</span>
        <span className="shrink-0 font-mono text-sm tabular-nums text-foreground">
          {moneySigned(row.gap, currency)}
        </span>
      </div>
      <div aria-hidden className="h-1.5 rounded-full bg-secondary">
        <div
          className={`h-full min-w-[3px] rounded-full ${above ? "bg-(--rose)" : "bg-(--volt)"}`}
          style={{ width: `${width}%` }}
        />
      </div>
    </li>
  );
}

function GapList(props: {
  heading: string;
  rows: Row[];
  of: number;
  max: number;
  currency: string;
}) {
  if (props.rows.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <h4 className="m-0 text-sm font-semibold text-foreground">
        {props.heading}
        <span className="font-normal text-muted-foreground">
          {" "}
          · largest {props.rows.length} of {props.of}
        </span>
      </h4>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {props.rows.map((r) => (
          <GapRow key={r.title} row={r} max={props.max} currency={props.currency} />
        ))}
      </ul>
    </div>
  );
}

/**
 * Hindsight drill-down for the Value summary: what was paid for each title
 * against its all-time low. Closed by default; its one-line answer is always
 * visible in the summary row.
 */
export function PaidVsLow({
  stat,
  currency,
}: {
  stat: PaidVsLowStat | null;
  currency: string;
}) {
  if (!stat) return null;
  const aboveAll = stat.rows.filter((r) => r.gap > 0);
  const belowAll = stat.rows.filter((r) => r.gap < 0);
  const above = aboveAll.slice(0, SHOW_ABOVE);
  const below = belowAll.slice(-SHOW_BELOW).reverse();
  // Both lists share one scale, so a bar length means the same on either side.
  const max = Math.max(...[...above, ...below].map((r) => Math.abs(r.gap)), 0);
  const total = stat.rows.length;
  const takeaway =
    stat.aboveCount > 0
      ? `${stat.aboveCount} of ${plural(total, "title")} cost more than their all-time low, ${money(stat.aboveTotal, currency)} in total (${pct(stat.aboveTotal / stat.paidTotal)} of what they cost). ${stat.atOrBelowCount} matched or beat it.`
      : `All ${plural(total, "title")} matched or beat the all-time low on record.`;

  return (
    <details className="v-disclosure">
      <summary>
        <span className="v-disclosure-title">Hindsight</span>
        <span className="v-disclosure-line">{takeaway}</span>
        <ChevronDownIcon className="v-disclosure-chevron" aria-hidden />
      </summary>
      <div className="v-disclosure-body flex min-w-0 flex-col gap-4">
        <div className="grid gap-x-10 gap-y-5 md:grid-cols-2">
          <GapList
            heading="Paid above the low"
            rows={above}
            of={aboveAll.length}
            max={max}
            currency={currency}
          />
          <GapList
            heading="Paid below the low"
            rows={below}
            of={belowAll.length}
            max={max}
            currency={currency}
          />
        </div>
        <p className="m-0 max-w-[80ch] text-xs leading-relaxed text-muted-foreground">
          Hindsight, not a mistake: the low is the best Steam price on record as
          of the last price refresh, and it may have appeared after you bought;
          no date is stored for it. Bundles are left out
          {stat.noLowCount > 0
            ? `, and ${plural(stat.noLowCount, "title")} with no low on record ${stat.noLowCount === 1 ? "is" : "are"} not compared`
            : ""}
          .
        </p>
        <details className="min-w-0 text-xs">
          <summary className="w-fit cursor-pointer rounded-sm py-1 text-xs text-primary">
            Show all {total} titles compared as a table
          </summary>
          <div className="mt-2 max-h-80 overflow-auto rounded-md border border-border">
            <DataTable
              caption="Price paid against the all-time low for each purchased title"
              head={["Game", "Paid", "All-time low", "Difference"]}
              rows={stat.rows.map((r) => [
                r.title,
                money(r.paid, currency),
                money(r.lowest, currency),
                moneySigned(r.gap, currency),
              ])}
            />
          </div>
        </details>
      </div>
    </details>
  );
}
