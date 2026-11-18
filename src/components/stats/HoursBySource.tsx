import type { HoursBySourceStat } from "@/lib/stats";
import { BarList, type BarItem } from "./BarList";
import { DataTable, MissingBoard, StatBoard } from "./StatBoard";
import { hours, pct, plural } from "./format";

const TITLE = "Do I play what I buy, what I am given, or what I borrow?";

const SOURCE_LABEL: Record<string, string> = {
  purchased: "Bought",
  bundle: "Came in a bundle",
  gifted_to_me: "Gifted to me",
  free: "Free",
  other_owned: "Owned, no purchase found",
  family: "Family library",
  unattributed: "No record of how I got it",
};

/** Below this share of hours the gap is too small to qualify the split. */
const INCOMPLETE_AT = 0.1;

export function HoursBySource({
  stat,
  licences,
}: {
  stat: HoursBySourceStat | null;
  /** State of the saved licence list; undefined on payloads without it. */
  licences?: {
    status: string;
    detail?: string;
    coverage?: { recordsCovered: number; recordsTotal: number };
  } | null;
}) {
  if (!stat) {
    return (
      <MissingBoard
        title={TITLE}
        missing="No game in the library has any recorded playtime."
        command="npm run fetch:owned-games"
      />
    );
  }
  const items: BarItem[] = stat.rows.map((r) => ({
    key: r.source,
    label: SOURCE_LABEL[r.source] ?? r.source,
    detail: `${r.played} of ${plural(r.titles, "title")} played`,
    value: r.hours,
    display: `${hours(r.hours)} · ${pct(r.share)}`,
    hollow: r.source === "unattributed" || r.source === "other_owned",
    tone: "steam",
  }));
  const [top, second] = stat.rows;
  const lead = `${SOURCE_LABEL[top.source]} games account for ${pct(top.share)} of your ${hours(stat.totalHours)}`;
  // Older payloads have no combined figure: fall back to the unattributed share.
  const unexplained = stat.unexplainedShare ?? stat.unattributedShare;
  const licencesIncomplete = licences != null && licences.status !== "ok";
  const fix =
    licences?.status === "unknown"
      ? "npm run parse:account-data"
      : "npm run fetch:account-data";
  const takeaway =
    unexplained >= INCOMPLETE_AT
      ? `${lead} — but ${pct(unexplained)} sit on owned games that nothing in purchase history, gift mail or the licence list explains, so the split is incomplete.${
          licencesIncomplete
            ? ` The saved licence list is incomplete; ${fix} completes it.`
            : ""
        }`
      : licencesIncomplete
        ? `${lead}. The saved licence list is incomplete, so some games may be filed under the wrong source; ${fix} completes it.`
        : second && second.share >= 0.1
        ? `${lead}; "${SOURCE_LABEL[second.source].toLowerCase()}" comes next at ${pct(second.share)}.`
        : `${lead}.`;

  return (
    <StatBoard
      title={TITLE}
      takeaway={takeaway}
      note={
        unexplained > 0
          ? `Each game is counted once, by how it reached the library. Dashed bars are not categories: they are hours on owned games that no purchase, gift or licence record explains${
              licencesIncomplete
                ? `, because the saved licence list is incomplete${
                    licences?.coverage && licences.coverage.recordsTotal > 0
                      ? ` (the saved pages cover ${licences.coverage.recordsCovered} of ${licences.coverage.recordsTotal} licence records)`
                      : licences?.detail
                        ? ` (${licences.detail})`
                        : ""
                  }`
                : ", usually because the saved licence list is incomplete"
            }. Running ${fix} fills them in.`
          : "Each game is counted once, by how it reached the library."
      }
      table={
        <DataTable
          caption="Lifetime hours by how each game was acquired"
          head={["Source", "Titles", "Played", "Hours", "Share"]}
          rows={stat.rows.map((r) => [
            SOURCE_LABEL[r.source] ?? r.source,
            r.titles,
            r.played,
            hours(r.hours),
            pct(r.share),
          ])}
        />
      }
    >
      <BarList items={items} label="Lifetime hours by how each game was acquired" />
    </StatBoard>
  );
}
