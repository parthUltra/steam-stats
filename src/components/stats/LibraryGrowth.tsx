import type { LibraryGrowthStat } from "@/lib/stats";
import { DataTable, MissingBoard, StatBoard } from "./StatBoard";
import { StepChart } from "./StepChart";
import { monthLabel, pct, plural } from "./format";

const TITLE = "How did my library build up?";
const MISSING =
  "Acquisition dates come from purchase history and the licences page, and the saved licences page is incomplete.";

export function LibraryGrowth({ stat }: { stat: LibraryGrowthStat | null }) {
  if (!stat) {
    return (
      <MissingBoard
        title={TITLE}
        missing={`No owned game has an acquisition date. ${MISSING}`}
        command="npm run fetch:account-data"
      />
    );
  }
  if (!stat.chartable) {
    // A curve over barely half the library would understate every month.
    return (
      <MissingBoard
        title={TITLE}
        missing={`Only ${stat.datedCount} of ${plural(stat.ownedCount, "owned game")} (${pct(stat.coverage)}) have a known acquisition date${
          stat.busiestMonth
            ? ` — the busiest known month is ${monthLabel(stat.busiestMonth.month)} with ${stat.busiestMonth.added}`
            : ""
        }. That is too thin to draw a growth curve without implying the rest arrived at some other time. ${MISSING}`}
        command="npm run fetch:account-data"
      />
    );
  }
  const takeaway = stat.busiestMonth
    ? `The biggest single month was ${monthLabel(stat.busiestMonth.month)}, when ${plural(stat.busiestMonth.added, "game")} arrived.`
    : `${plural(stat.datedCount, "game")} with a known date.`;
  return (
    <StatBoard
      title={TITLE}
      takeaway={takeaway}
      note={`Covers the ${stat.datedCount} of ${plural(stat.ownedCount, "owned game")} (${pct(stat.coverage)}) with a known acquisition date; the rest are not placed on the timeline rather than guessed. Family-library games are excluded.`}
      table={
        <DataTable
          caption="Games added per month with running total"
          head={["Month", "Added", "Running total"]}
          rows={stat.points
            .filter((p) => p.added > 0)
            .map((p) => [monthLabel(p.month), p.added, p.total])}
        />
      }
    >
      <StepChart
        points={stat.points.map((p) => ({
          month: p.month,
          step: p.total,
          bar: p.added,
        }))}
        unit={{ kind: "count" }}
        color="var(--steam)"
        stepName="Dated games owned"
        barName="Added that month"
        summary={`Running count of owned games by acquisition month. ${takeaway}`}
      />
    </StatBoard>
  );
}
