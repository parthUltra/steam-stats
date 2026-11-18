import { ChevronDownIcon } from "lucide-react";
import type { CohortsStat } from "@/lib/stats";
import { hours, money, pct, plural } from "./format";

/**
 * Purchase cohorts as a compact table behind a disclosure in the Spend over
 * time board: one row per purchase year. The one-line answer stays visible.
 */
export function Cohorts({
  stat,
  currency,
}: {
  stat: CohortsStat | null;
  currency: string;
}) {
  if (!stat || stat.rows.length === 0) return null;
  const worst = stat.rows.reduce((a, b) => (b.unplayedPaid > a.unplayedPaid ? b : a));
  const takeaway =
    worst.unplayedPaid > 0
      ? `Of the ${plural(worst.titles, "title")} bought in ${worst.year}, ${worst.played} got real playtime; ${money(worst.unplayedPaid, currency)} of that year's ${money(worst.paid, currency)} went on titles still unplayed.`
      : "Every dated purchase has at least 30 minutes of play.";

  return (
    <details className="v-disclosure">
      <summary>
        <span className="v-disclosure-title">By purchase year</span>
        <span className="v-disclosure-line">{takeaway}</span>
        <ChevronDownIcon className="v-disclosure-chevron" aria-hidden />
      </summary>
      <div className="v-disclosure-body">
        <table className="v-table v-cohort-table">
          <caption className="sr-only">
            Titles bought, share played, lifetime hours and unplayed spend per
            purchase year
          </caption>
          <thead>
            <tr>
              <th scope="col">Bought in</th>
              <th scope="col" className="v-num v-cohort-wide">
                Titles
              </th>
              <th scope="col">Played 30 min or more</th>
              <th scope="col" className="v-num v-cohort-wide">
                Hours since
              </th>
              <th scope="col" className="v-num">
                Paid
              </th>
              <th scope="col" className="v-num">
                Still unplayed
              </th>
            </tr>
          </thead>
          <tbody>
            {stat.rows.map((r) => (
              <tr key={r.year}>
                <th scope="row" className="mono v-cohort-year">
                  {r.year}
                </th>
                <td className="v-num v-cohort-wide">{r.titles}</td>
                <td>
                  <span className="v-cohort-played">
                    <span className="v-cohort-meter" aria-hidden>
                      <span style={{ width: `${r.playedShare * 100}%` }} />
                    </span>
                    <span className="mono">
                      {r.played} of {r.titles}
                      <span className="v-quiet"> · {pct(r.playedShare)}</span>
                    </span>
                  </span>
                </td>
                <td className="v-num v-cohort-wide">{hours(r.hours)}</td>
                <td className="v-num">{money(r.paid, currency)}</td>
                <td className={`v-num ${r.unplayedPaid > 0 ? "rose" : "v-quiet"}`}>
                  {r.unplayedPaid > 0 ? money(r.unplayedPaid, currency) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="v-disclosure-note">
          Grouped by the year each title was bought. Hours are lifetime hours on
          those titles up to now, not hours played in that year; Steam keeps no
          per-year playtime.
          {stat.undatedTitles > 0
            ? ` ${plural(stat.undatedTitles, "priced title")} (${money(stat.undatedPaid, currency)}) could not be matched to a purchase date by exact name and are left out.`
            : ""}
        </p>
      </div>
    </details>
  );
}
