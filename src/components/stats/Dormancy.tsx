import type { DormancyStat } from "@/lib/stats";
import { BarList, type BarItem } from "./BarList";
import { DataTable, MissingBoard, StatBoard } from "./StatBoard";
import { dateLabel, hours, monthOfDate, plural, span } from "./format";

const TITLE = "What have I drifted away from?";

const BUCKET_LABEL: Record<string, string> = {
  month: "Played in the last 30 days",
  half: "1–6 months ago",
  year: "6–12 months ago",
  older: "Over a year ago",
  unknown: "No last-played date",
};

export function Dormancy({ stat }: { stat: DormancyStat | null }) {
  if (!stat) {
    return (
      <MissingBoard
        title={TITLE}
        missing="No played game carries a last-played date."
        command="npm run fetch:owned-games"
      />
    );
  }
  const buckets = stat.buckets.filter((b) => b.id !== "unknown" || b.count > 0);
  const older = stat.buckets.find((b) => b.id === "older");
  const recent = stat.buckets.find((b) => b.id === "month");
  const items: BarItem[] = buckets.map((b) => ({
    key: b.id,
    label: BUCKET_LABEL[b.id],
    detail: `${hours(b.hours)} lifetime`,
    value: b.count,
    display: String(b.count),
    unit: b.count === 1 ? "game" : "games",
    tone: b.id === "unknown" ? "muted" : "steam",
    hollow: b.id === "unknown",
  }));
  const takeaway = `${older?.count ?? 0} of ${plural(stat.playedCount, "played game")} have not been opened in over a year; ${recent?.count ?? 0} ${
    recent?.count === 1 ? "was" : "were"
  } played in the last 30 days.`;

  return (
    <StatBoard
      title={TITLE}
      takeaway={takeaway}
      note={`Measured back from ${dateLabel(stat.asOf)}, when playtime was last fetched — not from today. Steam only records the most recent session, so this shows when a game was last opened, not how often.`}
      table={
        <DataTable
          caption="Played games by time since last played"
          head={["Last played", "Games", "Lifetime hours"]}
          rows={buckets.map((b) => [BUCKET_LABEL[b.id], b.count, hours(b.hours)])}
        />
      }
    >
      <BarList items={items} label="Played games by time since last played" />
      {stat.shelved.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h4 className="m-0 text-sm font-semibold text-foreground">
            Loved, then left
            <span className="font-normal text-muted-foreground">
              {" "}
              · 10+ hours, untouched for a year
              {stat.shelvedCount > stat.shelved.length
                ? ` · top ${stat.shelved.length} of ${stat.shelvedCount}`
                : ""}
            </span>
          </h4>
          <ul className="m-0 flex list-none flex-col p-0">
            {stat.shelved.map((g) => (
              <li
                key={g.appId}
                className="flex min-w-0 items-baseline justify-between gap-3 border-t border-border py-1.5 first:border-t-0"
              >
                <span className="min-w-0 truncate text-sm text-foreground">{g.name}</span>
                <span className="shrink-0 text-right text-xs text-muted-foreground">
                  <span className="font-mono text-sm tabular-nums text-foreground">
                    {hours(g.hours)}
                  </span>{" "}
                  · last {monthOfDate(g.lastPlayedAt)} ({span(g.idleDays)})
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </StatBoard>
  );
}
