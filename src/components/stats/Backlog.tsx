import type { BacklogStat } from "@/lib/stats";
import { Figure } from "./BarList";
import { DataTable, MissingBoard, StatBoard } from "./StatBoard";
import { dateLabel, hours, money, monthOfDate, pct, plural, span } from "./format";

const TITLE = "How much of what I own have I never played?";
const SHOWN = 6;

export function Backlog({
  stat,
  currency,
}: {
  stat: BacklogStat | null;
  currency: string;
}) {
  if (!stat) {
    return (
      <MissingBoard
        title={TITLE}
        missing="There are no owned games or priced purchases to check."
        command="npm run fetch:account-data"
      />
    );
  }
  const dated = stat.rows.filter((r) => r.shelfDays != null).length;
  const playedPaid = stat.paidTotal - stat.paidCost;
  const takeaway =
    stat.paidCount > 0
      ? `${stat.neverPlayedCount} of ${plural(stat.ownedCount, "owned game")} have never been launched (zero recorded playtime). Separately, ${plural(stat.paidCount, "title")} you paid for ${stat.paidCount === 1 ? "has" : "have"} under 30 minutes of play — ${money(stat.paidCost, currency)}, or ${pct(stat.share)} of what your priced titles cost.`
      : `${stat.neverPlayedCount} of ${plural(stat.ownedCount, "owned game")} have never been launched (zero recorded playtime), and no title you paid for has under 30 minutes of play.`;
  const shown = stat.rows.slice(0, SHOWN);

  return (
    <StatBoard
      title={TITLE}
      takeaway={takeaway}
      note={`Two measures: "never launched" is zero recorded playtime across everything owned; the money figures count paid titles with under 30 minutes of play. Money covers the ${plural(stat.paidTitlesTotal, "title")} with a recorded price; family-library games are left out. Shelf time runs to ${dateLabel(stat.asOf)}${
        stat.paidCount > dated
          ? ` and is known for ${dated} of ${stat.paidCount} (the rest have no exact match in purchase history)`
          : ""
      }.`}
      table={
        stat.rows.length > 0 ? (
          <DataTable
            caption="Paid titles with under 30 minutes of play"
            head={["Game", "Paid", "Played", "Bought", "On the shelf"]}
            rows={stat.rows.map((r) => [
              r.title,
              money(r.paid, currency),
              hours(r.hours),
              r.boughtAt != null ? monthOfDate(r.boughtAt) : "—",
              r.shelfDays != null ? span(r.shelfDays) : "—",
            ])}
          />
        ) : undefined
      }
    >
      <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        <Figure
          value={`${stat.neverPlayedCount} / ${stat.ownedCount}`}
          label="owned games never launched"
        />
        <Figure
          value={money(stat.paidCost, currency)}
          label={`paid for ${plural(stat.paidCount, "title")} under 30 min`}
          tone="rose"
        />
        {stat.medianShelfDays != null ? (
          <Figure
            value={span(stat.medianShelfDays).split(" ")[0]}
            unit={span(stat.medianShelfDays).split(" ").slice(1).join(" ")}
            label="typical wait since purchase"
          />
        ) : null}
      </dl>

      {stat.paidTotal > 0 ? (
        <div className="flex flex-col gap-1.5">
          <div
            role="img"
            aria-label={`${pct(1 - stat.share)} of spend went on titles played 30 minutes or more, ${pct(stat.share)} on titles under 30 minutes.`}
            className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full"
          >
            <div
              className="h-full bg-(--amber)"
              style={{ width: `${(1 - stat.share) * 100}%` }}
            />
            <div className="h-full flex-1 bg-(--rose)" />
          </div>
          <div className="flex justify-between gap-3 text-xs text-muted-foreground">
            <span>
              Played 30 min or more{" "}
              <span className="font-mono tabular-nums text-foreground">
                {money(playedPaid, currency)}
              </span>
            </span>
            <span className="text-right">
              Under 30 min{" "}
              <span className="font-mono tabular-nums text-foreground">
                {money(stat.paidCost, currency)}
              </span>
            </span>
          </div>
        </div>
      ) : null}

      {shown.length > 0 ? (
        <ul
          aria-label="Most expensive paid titles with under 30 minutes of play"
          className="m-0 flex list-none flex-col p-0"
        >
          {shown.map((r) => (
            <li
              key={r.title}
              className="flex min-w-0 items-baseline justify-between gap-3 border-t border-border py-1.5 first:border-t-0"
            >
              <span className="min-w-0 truncate text-sm text-foreground">{r.title}</span>
              <span className="shrink-0 text-right text-xs text-muted-foreground">
                {r.shelfDays != null ? `${span(r.shelfDays)} · ` : ""}
                <span className="font-mono text-sm tabular-nums text-foreground">
                  {money(r.paid, currency)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {stat.rows.length > shown.length ? (
        <p className="m-0 text-xs text-muted-foreground">
          Showing the {shown.length} most expensive of {stat.rows.length}.
        </p>
      ) : null}
    </StatBoard>
  );
}
