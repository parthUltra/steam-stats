import type { DistributionStat } from "@/lib/stats";
import { DataTable, MissingBoard, StatBoard } from "./StatBoard";
import { hours, pct, plural } from "./format";

const TITLE = "How deep do I usually go into a game?";

const BIN_LABEL: Record<string, string> = {
  "0": "Never",
  lt1: "Under 1 h",
  "1-5": "1–5 h",
  "5-10": "5–10 h",
  "10-25": "10–25 h",
  "25-50": "25–50 h",
  "50-100": "50–100 h",
  "100-250": "100–250 h",
  "250+": "250 h+",
};

function Bar({ share }: { share: number }) {
  return (
    <div aria-hidden className="h-2 min-w-0 flex-1 rounded-full bg-secondary">
      {share > 0 ? (
        <div
          className="h-full min-w-[3px] rounded-full bg-primary"
          style={{ width: `${Math.min(1, share) * 100}%` }}
        />
      ) : null}
    </div>
  );
}

export function PlaytimeDistribution({ stat }: { stat: DistributionStat | null }) {
  if (!stat) {
    return (
      <MissingBoard
        title={TITLE}
        missing="The library has no games yet."
        command="npm run fetch:owned-games"
      />
    );
  }
  const maxCount = Math.max(...stat.bins.map((b) => b.count));
  const maxShare = Math.max(...stat.bins.map((b) => b.hoursShare));
  const shallow = stat.bins.slice(0, 3).reduce((n, b) => n + b.count, 0);
  const deepBins = stat.bins.slice(6);
  const deepCount = deepBins.reduce((n, b) => n + b.count, 0);
  const deepShare = deepBins.reduce((n, b) => n + b.hoursShare, 0);
  const takeaway =
    stat.totalHours > 0
      ? `${shallow} of ${plural(stat.gameCount, "game")} stopped before 5 hours, while the ${plural(deepCount, "game")} past 50 hours hold ${pct(deepShare)} of all playtime.${
          stat.medianPlayedHours != null
            ? ` A typical played game got ${hours(stat.medianPlayedHours)}.`
            : ""
        }`
      : `None of the ${plural(stat.gameCount, "game")} has been played yet.`;

  return (
    <StatBoard
      title={TITLE}
      takeaway={takeaway}
      note="Games grouped by lifetime hours. The ranges widen as they go (each is roughly double the last), so compare bars within a column, not their spacing."
      table={
        <DataTable
          caption="Games and share of hours per playtime range"
          head={["Lifetime hours", "Games", "Hours", "Share of hours"]}
          rows={stat.bins.map((b) => [
            BIN_LABEL[b.id] ?? b.id,
            b.count,
            hours(b.hours),
            pct(b.hoursShare),
          ])}
        />
      }
    >
      <div
        role="img"
        aria-label={`Games per playtime range. ${takeaway}`}
        className="grid grid-cols-[5.25rem_minmax(0,1fr)_minmax(0,1fr)] items-center gap-x-3 gap-y-2 sm:gap-x-5"
      >
        <span className="text-xs text-muted-foreground">Played</span>
        <span className="text-xs text-muted-foreground">Games</span>
        <span className="text-xs text-muted-foreground">Share of hours</span>
        {stat.bins.map((b) => (
          <div key={b.id} className="contents">
            <span className="text-sm text-foreground">{BIN_LABEL[b.id] ?? b.id}</span>
            <span className="flex min-w-0 items-center gap-2">
              <Bar share={maxCount > 0 ? b.count / maxCount : 0} />
              <span className="w-7 shrink-0 text-right font-mono text-sm tabular-nums">
                {b.count}
              </span>
            </span>
            <span className="flex min-w-0 items-center gap-2">
              <Bar share={maxShare > 0 ? b.hoursShare / maxShare : 0} />
              <span className="w-10 shrink-0 text-right font-mono text-sm tabular-nums">
                {pct(b.hoursShare)}
              </span>
            </span>
          </div>
        ))}
      </div>
    </StatBoard>
  );
}
