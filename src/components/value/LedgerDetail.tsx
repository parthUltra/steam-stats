"use client";

import { ChevronDownIcon } from "lucide-react";
import type { RecentPurchase } from "@/lib/analytics/contracts";
import type { SpendingAnalytics } from "@/lib/analytics/spending";
import { formatDay, moneyFmt } from "@/components/value/format";

/** Everything that backs the boards above, closed until asked for. */
export function LedgerDetail({
  spending,
  recentPurchases,
  currency,
  money,
  notes,
}: {
  spending: SpendingAnalytics;
  recentPurchases: RecentPurchase[];
  currency: string;
  money: (n: number) => string;
  /** How the totals are computed, in the analytics layer's own words. */
  notes: string[];
}) {
  const recent = recentPurchases.slice(0, 10);
  return (
    <details className="v-panel v-ledger">
      <summary>
        <span className="v-ledger-title">Ledger detail</span>
        <span className="v-ledger-sub">
          Recent transactions, purchase habits, licence mix and how the totals
          are computed
        </span>
        <ChevronDownIcon className="v-ledger-chevron" aria-hidden />
      </summary>
      <div className="v-ledger-body">
        <div>
          <h3>Recent transactions</h3>
          {recent.length === 0 ? (
            <p className="v-empty">No transactions parsed yet.</p>
          ) : (
            <div className="v-table-wrap">
              <table className="v-table v-ledger-table">
                <caption className="sr-only">
                  Last {recent.length} transactions
                </caption>
                <thead>
                  <tr>
                    <th scope="col" className="v-col-day">
                      Date
                    </th>
                    <th scope="col">Items</th>
                    <th scope="col" className="v-num">
                      Discount
                    </th>
                    <th scope="col" className="v-num">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((p, idx) => {
                    const extra = p.items.length - 2;
                    const off =
                      p.discountPct != null && p.discountPct !== 0
                        ? Math.abs(Math.round(p.discountPct))
                        : null;
                    return (
                      <tr key={`${p.date}-${idx}`}>
                        <td className="v-col-day v-quiet">{formatDay(p.date)}</td>
                        <td className="v-cell-title">
                          <span className="v-title">
                            <span>
                              {p.items.slice(0, 2).join(", ") || p.type}
                              {extra > 0 ? ` and ${extra} more` : ""}
                              {p.refunded ? " (refunded)" : ""}
                            </span>
                          </span>
                        </td>
                        <td className="v-num v-quiet">
                          {off != null ? `−${off}%` : "—"}
                        </td>
                        <td className="v-num">
                          {p.total != null
                            ? moneyFmt(p.total, p.currency ?? currency)
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="v-ledger-side">
          <h3>Habits</h3>
          <ul className="v-plain-list">
            {spending.habits.map((h) => (
              <li key={h}>{h}</li>
            ))}
            <li>
              Average purchase{" "}
              <span className="mono">{money(spending.avgPurchase)}</span>, median{" "}
              <span className="mono">{money(spending.medianPurchase)}</span>.
            </li>
            {spending.saleSavings > 0 ? (
              <li>
                Sale savings against list price:{" "}
                <span className="mono">{money(spending.saleSavings)}</span>.
              </li>
            ) : null}
          </ul>

          {spending.licenseMix.length > 0 ? (
            <>
              <h3>Licence mix</h3>
              <p className="v-ledger-text">
                {spending.licenseMix.map((l, i) => (
                  <span key={l.method}>
                    {i > 0 ? " · " : ""}
                    {l.method} <span className="mono">{l.count}</span>
                  </span>
                ))}
              </p>
            </>
          ) : null}

          {notes.length > 0 ? (
            <>
              <h3>How the totals are computed</h3>
              {notes.map((n) => (
                <p key={n} className="v-ledger-text">
                  {n}
                </p>
              ))}
            </>
          ) : null}
        </div>
      </div>
    </details>
  );
}
