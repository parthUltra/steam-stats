import type { ArtworkMap, DashboardMeta } from "@/lib/analytics/contracts";
import type { StatsPayload, StatTab } from "@/lib/stats";
import { Backlog } from "./Backlog";
import { Dormancy } from "./Dormancy";
import { HoursBySource } from "./HoursBySource";
import { LibraryGrowth } from "./LibraryGrowth";
import { PlaytimeConcentration } from "./PlaytimeConcentration";
import { PlaytimeDistribution } from "./PlaytimeDistribution";

/** Mount point for the stats boards of one tab. */
export function StatsSection(props: {
  tab: StatTab;
  stats: StatsPayload;
  currency: string;
  /** Reserved: the boards are text-first and do not draw artwork yet. */
  artwork: ArtworkMap;
  /** State of each Account Data source; lets a board say why it has gaps. */
  sourceStatus?: DashboardMeta["sourceStatus"];
}): React.ReactElement | null {
  const { stats, currency } = props;
  // A payload built before the stats existed has none of these keys.
  if (!stats || !("concentration" in stats)) return null;

  // The Value tab folds its stats into its own boards (see SpendingValue).
  if (props.tab !== "library") return null;

  return (
    <section
      aria-label="Playtime statistics"
      className="mt-6 grid grid-cols-1 items-start gap-5 lg:grid-cols-2"
    >
      <PlaytimeConcentration stat={stats.concentration} />
      <PlaytimeDistribution stat={stats.distribution} />
      <Dormancy stat={stats.dormancy} />
      <Backlog stat={stats.backlog} currency={currency} />
      <HoursBySource
        stat={stats.hoursBySource}
        licences={props.sourceStatus?.licenses ?? null}
      />
      <LibraryGrowth stat={stats.libraryGrowth} />
    </section>
  );
}
