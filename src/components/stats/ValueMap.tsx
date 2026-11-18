import type { ValueMapStat } from "@/lib/stats";
import { ValueMapChart, type MapPoint } from "./ValueMapChart";
import { hours, money, moneyPerHour, pct, plural } from "./format";

function shorten(title: string): string {
  return title.length > 20 ? `${title.slice(0, 19).trimEnd()}…` : title;
}

/**
 * The paid-against-hours map as a figure for the Cost per hour board: the
 * chart, a key for its three marks, and what the map leaves out. The table
 * beside it carries the exact values, so there is no separate data table.
 */
export function ValueMap({
  stat,
  currency,
  activeTitle,
  onActive,
}: {
  stat: ValueMapStat;
  currency: string;
  activeTitle?: string | null;
  onActive?: (title: string | null) => void;
}) {
  const stealTitles = new Set(stat.steals.map((s) => s.title));
  const regretTitles = new Set(stat.regrets.map((r) => r.title));
  const toPoint = (p: ValueMapStat["points"][number], labelled: boolean): MapPoint => ({
    title: p.title,
    paid: p.paid,
    hours: p.hours,
    rate: p.rate,
    label: labelled ? shorten(p.title) : "",
  });
  const steals = stat.points.filter((p) => stealTitles.has(p.title)).map((p) => toPoint(p, true));
  const regrets = stat.points
    .filter((p) => regretTitles.has(p.title) && !stealTitles.has(p.title))
    .map((p) => toPoint(p, true));
  const plain = stat.points
    .filter((p) => !stealTitles.has(p.title) && !regretTitles.has(p.title))
    .map((p) => toPoint(p, false));

  const total = stat.points.length + stat.unplayed.length;
  const best = stat.steals[0];
  const summary = `Scatter of ${plural(stat.points.length, "paid title")}: price paid against hours played, both on log scales. ${stat.points.length} of ${plural(total, "paid title")} got 30 minutes or more${
    best ? `; the cheapest hours are ${best.title} at ${moneyPerHour(best.rate, currency)}` : ""
  }. The table lists every value.`;
  const unplayedPaid = stat.unplayed.reduce((s, u) => s + u.paid, 0);

  return (
    <figure className="value-map">
      <ValueMapChart
        points={plain}
        steals={steals}
        regrets={regrets}
        currency={currency}
        summary={summary}
        activeTitle={activeTitle}
        onActive={onActive}
        heightClass="h-[320px] min-[1180px]:h-[392px]"
      />
      <figcaption>
        <span className="value-map-key">
          <span>
            <i className="value-map-dot" aria-hidden /> one paid title
          </span>
          {steals.length > 0 ? (
            <span>
              <i className="value-map-steal" aria-hidden /> cheapest hours, 10 h or
              more
            </span>
          ) : null}
          {regrets.length > 0 ? (
            <span>
              <i className="value-map-regret" aria-hidden /> paid most, under 2 h
            </span>
          ) : null}
        </span>
        Further right is more hours, lower is cheaper; anything below a dashed
        line beat that cost per hour.
        {stat.unplayed.length > 0
          ? ` Not on the map: ${plural(stat.unplayed.length, "paid title")} under 30 minutes, ${money(unplayedPaid, currency)} in all (see Unplayed).`
          : ""}
        {stat.totalHours > 0
          ? ` Covers ${hours(stat.hoursCovered)} of ${hours(stat.totalHours)} lifetime playtime (${pct(stat.hoursCovered / stat.totalHours)}); free, gifted and family titles have no price to plot.`
          : ""}
      </figcaption>
    </figure>
  );
}
