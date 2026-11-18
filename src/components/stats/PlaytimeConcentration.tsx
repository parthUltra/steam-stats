import type { ConcentrationStat } from "@/lib/stats";
import { BarList, type BarItem } from "./BarList";
import { DataTable, MissingBoard, StatBoard } from "./StatBoard";
import { hours, pct, plural } from "./format";

const TITLE = "Is my playtime really just a handful of games?";

function takeaway(stat: ConcentrationStat): string {
  if (stat.playedCount === 1) {
    return `All ${hours(stat.totalHours)} are on one game: ${stat.top[0].name}.`;
  }
  const half =
    stat.gamesForHalf === 1
      ? `${stat.top[0].name} alone is ${pct(stat.top[0].share)} of everything you have played`
      : `${stat.gamesForHalf} games make up half of everything you have played`;
  return `${half}; ${stat.gamesFor80} of ${stat.playedCount} played games cover 80%.`;
}

export function PlaytimeConcentration({ stat }: { stat: ConcentrationStat | null }) {
  if (!stat) {
    return (
      <MissingBoard
        title={TITLE}
        missing="No game in the library has any recorded playtime."
        command="npm run fetch:owned-games"
      />
    );
  }
  const items: BarItem[] = stat.top.map((row, i) => ({
    key: String(row.appId),
    label: `${i + 1}. ${row.name}`,
    detail: row.fromFamily ? "family library" : undefined,
    value: row.hours,
    display: `${hours(row.hours)} · ${pct(row.cumShare)}`,
  }));
  if (stat.otherCount > 0) {
    items.push({
      key: "other",
      label: `Other ${plural(stat.otherCount, "game")}`,
      value: stat.otherHours,
      display: `${hours(stat.otherHours)} · 100%`,
      tone: "muted",
    });
  }
  return (
    <StatBoard
      title={TITLE}
      takeaway={takeaway(stat)}
      note={`Lifetime hours per game, most played first. The percentage is the running share of all ${hours(stat.totalHours)} — read down the column to see how fast it climbs.`}
      table={
        <DataTable
          caption="Lifetime hours and running share for the most-played games"
          head={["Game", "Hours", "Share", "Running share"]}
          rows={[
            ...stat.top.map((r) => [r.name, hours(r.hours), pct(r.share), pct(r.cumShare)]),
            ...(stat.otherCount > 0
              ? [
                  [
                    `Other ${plural(stat.otherCount, "game")}`,
                    hours(stat.otherHours),
                    pct(stat.otherHours / stat.totalHours),
                    "100%",
                  ],
                ]
              : []),
          ]}
        />
      }
    >
      <BarList ordered items={items} label="Most-played games by lifetime hours" />
    </StatBoard>
  );
}
