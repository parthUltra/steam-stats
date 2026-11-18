"use client";

import { useId, useMemo, useRef, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from "lucide-react";
import type { SpendingAnalytics } from "@/lib/analytics/spending";
import type { StatsPayload } from "@/lib/stats";
import type { ArtworkUrls } from "@/lib/steam/artwork-resolve";
import { steamStoreUrl } from "@/lib/steam/artwork";
import { resolveArtworkAppId } from "@/lib/steam/resolve-app-id";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Cohorts } from "@/components/stats/Cohorts";
import { DiscountDepth } from "@/components/stats/DiscountDepth";
import { monthName, pct } from "@/components/stats/format";
import {
  formatDay,
  formatMonth,
  formatMonthLong,
} from "@/components/value/format";
import { SteamThumb } from "@/components/value/SteamThumb";
import { PaymentMix } from "@/components/value/PaymentMix";

type Month = SpendingAnalytics["monthly"][number];
type Slot = { key: string; year: string; monthIdx: number; row: Month | null };

const MONTH_INITIALS = "JFMAMJJASOND";

/** Every calendar month from the first purchase to the last, gaps included. */
function buildSlots(monthly: Month[]): Slot[] {
  const byKey = new Map(monthly.map((m) => [m.month, m]));
  const keys = [...byKey.keys()].sort();
  if (keys.length === 0) return [];
  const [y0, m0] = keys[0].split("-").map(Number);
  const [y1, m1] = keys[keys.length - 1].split("-").map(Number);
  const out: Slot[] = [];
  for (let y = y0, m = m0; y < y1 || (y === y1 && m <= m1); ) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    out.push({ key, year: String(y), monthIdx: m - 1, row: byKey.get(key) ?? null });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** Round the axis top up to a clean step so the top and half-way gridlines read as round values. */
function niceCeil(n: number): number {
  if (n <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(n));
  for (const step of [1, 1.5, 2, 3, 4, 5, 6, 8, 10]) {
    if (n <= step * pow) return step * pow;
  }
  return 10 * pow;
}

function pctOff(line: { amount: number; listAmount: number | null }) {
  return line.listAmount != null && line.listAmount > line.amount
    ? Math.round((1 - line.amount / line.listAmount) * 100)
    : null;
}

/**
 * Hand-rolled rather than Recharts: every bar has to be a real button (roving
 * focus, pressed state, a per-month accessible name), with year rules and gap
 * months laid out on the same CSS grid as the labels beneath. That is forty
 * lines of markup here and a fight with a chart library's SVG.
 */
export function SpendTimeline({
  spending,
  money,
  moneyAxis,
  artwork,
  titleCatalog,
  stats,
  currency,
}: {
  /** Stats folded into this board: running total, cohorts, discount depth. */
  stats?: StatsPayload | null;
  currency: string;
  spending: SpendingAnalytics;
  money: (n: number) => string;
  moneyAxis: (n: number) => string;
  artwork?: Record<string, ArtworkUrls>;
  titleCatalog: { title: string; steamAppId: number | null }[];
}) {
  const slots = useMemo(() => buildSlots(spending.monthly), [spending.monthly]);
  const lastWithSpend = useMemo(
    () => [...slots].reverse().find((s) => s.row)?.key ?? null,
    [slots],
  );
  /** `undefined` until the owner picks: then the latest month is shown. */
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  const selected = picked === undefined ? lastWithSpend : picked;
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [focusIdx, setFocusIdx] = useState<number | null>(null);
  const barRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const headingId = useId();
  const detailId = useId();

  const [mode, setMode] = useState<"month" | "total">("month");
  const total = spending.monthly.reduce((s, m) => s + m.spent, 0);
  /** Running total up to and including each slot. */
  const running = useMemo(() => {
    const out: number[] = [];
    for (const s of slots) {
      out.push((out[out.length - 1] ?? 0) + (s.row?.spent ?? 0));
    }
    return out;
  }, [slots]);
  const max =
    mode === "total" ? Math.max(1, total) : Math.max(1, ...slots.map((s) => s.row?.spent ?? 0));
  const top = niceCeil(max);
  const ticks = [top, top / 2];
  /** Step line for the running total, in a 0..N by 0..100 box. */
  const stepPath = running
    .map((v, i) => {
      const y = 100 - (v / top) * 100;
      return `${i === 0 ? `M0,100 V${y}` : `V${y}`} H${i + 1}`;
    })
    .join(" ");

  const cumulative = stats?.cumulativeSpend ?? null;
  const grid = stats?.purchaseGrid ?? null;
  const cohortByYear = new Map(
    (stats?.cohorts?.rows ?? []).map((r) => [r.year, r]),
  );
  const purchases = spending.monthly.reduce((s, m) => s + m.count, 0);
  const activeMonths = slots.filter((s) => s.row).length;

  const years = useMemo(() => {
    const out: { year: string; span: number; spent: number }[] = [];
    for (const s of slots) {
      const last = out[out.length - 1];
      if (last && last.year === s.year) {
        last.span += 1;
        last.spent += s.row?.spent ?? 0;
      } else {
        out.push({ year: s.year, span: 1, spent: s.row?.spent ?? 0 });
      }
    }
    return out;
  }, [slots]);

  const selectedIdx = slots.findIndex((s) => s.key === selected);
  const selectedRow = selectedIdx >= 0 ? slots[selectedIdx].row : null;
  /** The one bar in the tab order: last focused, else selected, else newest. */
  const tabIdx = focusIdx ?? (selectedIdx >= 0 ? selectedIdx : slots.length - 1);
  const tipIdx = hoverIdx ?? focusIdx;
  const tip = tipIdx != null ? slots[tipIdx] : null;

  const focusBar = (i: number) => {
    const next = Math.max(0, Math.min(slots.length - 1, i));
    barRefs.current[next]?.focus();
  };

  const stepSelected = (dir: 1 | -1) => {
    for (let i = selectedIdx + dir; i >= 0 && i < slots.length; i += dir) {
      if (slots[i].row) {
        setPicked(slots[i].key);
        return;
      }
    }
  };
  const hasPrev = slots.slice(0, Math.max(0, selectedIdx)).some((s) => s.row);
  const hasNext = selectedIdx >= 0 && slots.slice(selectedIdx + 1).some((s) => s.row);

  const lines = useMemo(
    () =>
      (selectedRow?.lines ?? []).map((line) => ({
        ...line,
        appId: resolveArtworkAppId(line.title, titleCatalog),
        off: pctOff(line),
      })),
    [selectedRow, titleCatalog],
  );
  const listTotal = lines.reduce((s, l) => s + (l.listAmount ?? l.amount), 0);
  const linesPaid = lines.reduce((s, l) => s + l.amount, 0);
  const monthOff =
    listTotal > linesPaid ? Math.round((1 - linesPaid / listTotal) * 100) : null;

  return (
    <section className="v-panel v-spend" aria-labelledby={headingId}>
      <div className="v-panel-head">
        <div>
          <h3 id={headingId}>Spend over time</h3>
          <p>
            {slots.length === 0 ? (
              "No purchases parsed yet."
            ) : (
              <>
                <span className="mono">{money(total)}</span> across{" "}
                <span className="mono">{purchases}</span>{" "}
                {purchases === 1 ? "purchase" : "purchases"} in{" "}
                <span className="mono">{activeMonths}</span> of{" "}
                <span className="mono">{slots.length}</span> months,{" "}
                {formatMonth(slots[0].key)} to{" "}
                {formatMonth(slots[slots.length - 1].key)}.
                {cumulative && cumulative.years.length > 1 ? (
                  <>
                    {" "}
                    <span className="mono">{pct(cumulative.topYear.share)}</span>{" "}
                    of it was spent in {cumulative.topYear.year}.
                  </>
                ) : null}
                {grid && grid.topMonths.monthIndexes.length > 1 && grid.years.length > 1 ? (
                  <>
                    {" "}
                    {grid.topMonths.monthIndexes.map(monthName).join(" and ")}{" "}
                    hold <span className="mono">{pct(grid.topMonths.share)}</span>{" "}
                    of all spend across the years.
                  </>
                ) : null}
              </>
            )}
          </p>
        </div>
        {slots.length > 0 ? (
          <ToggleGroup
            value={[mode]}
            onValueChange={(next) => {
              const v = next[0] as "month" | "total" | undefined;
              if (v) setMode(v);
            }}
            variant="outline"
            size="sm"
            spacing={0}
            aria-label="Chart shows"
          >
            <ToggleGroupItem value="month">Per month</ToggleGroupItem>
            <ToggleGroupItem value="total">Running total</ToggleGroupItem>
          </ToggleGroup>
        ) : null}
      </div>

      {slots.length > 0 ? (
        <>
          <div
            className="v-chart"
            data-mode={mode}
            style={{ ["--n" as string]: slots.length }}
          >
            <div className="v-chart-axis" aria-hidden>
              {ticks.map((t) => (
                <span key={t} style={{ bottom: `${(t / top) * 100}%` }}>
                  {moneyAxis(t)}
                </span>
              ))}
              <span style={{ bottom: 0 }}>0</span>
            </div>
            <div className="v-chart-plot">
              {ticks.map((t) => (
                <span
                  key={t}
                  className="v-chart-grid"
                  style={{ bottom: `${(t / top) * 100}%` }}
                  aria-hidden
                />
              ))}
              {mode === "total" ? (
                <svg
                  className="v-chart-step"
                  viewBox={`0 0 ${slots.length} 100`}
                  preserveAspectRatio="none"
                  aria-hidden
                >
                  <path className="v-chart-step-area" d={`${stepPath} V100 Z`} />
                  <path className="v-chart-step-line" d={stepPath} />
                </svg>
              ) : null}
              <div
                className="v-chart-bars"
                role="group"
                aria-label="Spend by month. Arrow keys move between months; Enter shows a month's purchases."
                onKeyDown={(e) => {
                  const i = focusIdx ?? tabIdx;
                  if (e.key === "ArrowRight") focusBar(i + 1);
                  else if (e.key === "ArrowLeft") focusBar(i - 1);
                  else if (e.key === "Home") focusBar(0);
                  else if (e.key === "End") focusBar(slots.length - 1);
                  else return;
                  e.preventDefault();
                }}
                onMouseLeave={() => setHoverIdx(null)}
              >
                {slots.map((s, i) => {
                  const spent = s.row?.spent ?? 0;
                  const isSelected = s.key === selected;
                  return (
                    <button
                      key={s.key}
                      ref={(el) => {
                        barRefs.current[i] = el;
                      }}
                      type="button"
                      className="v-bar"
                      data-empty={s.row ? undefined : ""}
                      data-year-start={s.monthIdx === 0 && i > 0 ? "" : undefined}
                      tabIndex={i === tabIdx ? 0 : -1}
                      aria-pressed={s.row ? isSelected : undefined}
                      aria-disabled={s.row ? undefined : true}
                      aria-controls={s.row ? detailId : undefined}
                      aria-label={
                        s.row
                          ? `${formatMonthLong(s.key)}: ${money(spent)}, ${s.row.count} ${s.row.count === 1 ? "purchase" : "purchases"}, running total ${money(running[i])}`
                          : `${formatMonthLong(s.key)}: no purchases, running total ${money(running[i])}`
                      }
                      onClick={() => {
                        if (!s.row) return;
                        setPicked(isSelected ? null : s.key);
                      }}
                      onMouseEnter={() => setHoverIdx(i)}
                      onFocus={() => setFocusIdx(i)}
                      onBlur={() => setFocusIdx((f) => (f === i ? null : f))}
                    >
                      <span
                        className="v-bar-fill"
                        style={{ height: s.row ? `${Math.max(1.5, (spent / top) * 100)}%` : undefined }}
                      />
                    </button>
                  );
                })}
              </div>
              {tip && tipIdx != null ? (
                <div
                  className="v-chart-tip"
                  data-edge={
                    tipIdx < slots.length * 0.15
                      ? "start"
                      : tipIdx > slots.length * 0.85
                        ? "end"
                        : undefined
                  }
                  style={{ left: `${((tipIdx + 0.5) / slots.length) * 100}%` }}
                  aria-hidden
                >
                  <strong>{formatMonth(tip.key)}</strong>
                  {tip.row ? (
                    <span>
                      <span className="mono">{money(tip.row.spent)}</span>
                      {" · "}
                      {tip.row.count} {tip.row.count === 1 ? "purchase" : "purchases"}
                    </span>
                  ) : (
                    <span>No purchases</span>
                  )}
                  <span>
                    <span className="mono">{money(running[tipIdx])}</span> so far
                  </span>
                </div>
              ) : null}
            </div>
            <div className="v-chart-months" aria-hidden>
              {slots.map((s) => (
                <span key={s.key} data-year-start={s.monthIdx === 0 ? "" : undefined}>
                  {MONTH_INITIALS[s.monthIdx]}
                </span>
              ))}
            </div>
            <div className="v-chart-years" aria-hidden>
              {years.map((y) => (
                <span
                  key={y.year}
                  style={{ gridColumn: `span ${y.span}` }}
                  data-narrow={y.span < 4 ? "" : undefined}
                >
                  <strong>{y.year}</strong>
                  <span className="mono">{money(y.spent)}</span>
                  {cohortByYear.get(y.year) ? (
                    <span className="v-chart-cohort">
                      {cohortByYear.get(y.year)!.played} of{" "}
                      {cohortByYear.get(y.year)!.titles} titles played
                    </span>
                  ) : null}
                </span>
              ))}
            </div>
          </div>

          {/* A table ignores the 1px clip box, so the wrapper carries sr-only. */}
          <div className="sr-only">
          <table>
            <caption>Spend by month, months with purchases only</caption>
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col">Spent</th>
                <th scope="col">Purchases</th>
                <th scope="col">Running total</th>
              </tr>
            </thead>
            <tbody>
              {slots.map((s, i) =>
                s.row ? (
                  <tr key={s.key}>
                    <th scope="row">{formatMonthLong(s.key)}</th>
                    <td>{money(s.row.spent)}</td>
                    <td>{s.row.count}</td>
                    <td>{money(running[i])}</td>
                  </tr>
                ) : null,
              )}
            </tbody>
          </table>
          </div>

          <div id={detailId} className="v-month">
            {selectedRow && selected ? (
              <>
                <div className="v-month-head">
                  <div aria-live="polite">
                    <h4>{formatMonth(selected)}</h4>
                    <p>
                      <span className="mono">{lines.length}</span>{" "}
                      {lines.length === 1 ? "title" : "titles"} in{" "}
                      <span className="mono">{selectedRow.count}</span>{" "}
                      {selectedRow.count === 1 ? "purchase" : "purchases"} ·{" "}
                      <span className="mono amber">{money(selectedRow.spent)}</span>{" "}
                      paid
                      {monthOff != null ? (
                        <>
                          {" · "}
                          <span className="mono">{money(listTotal)}</span> at
                          list price (<span className="mono">−{monthOff}%</span>)
                        </>
                      ) : null}
                    </p>
                  </div>
                  <div className="v-month-nav">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      disabled={!hasPrev}
                      onClick={() => stepSelected(-1)}
                      aria-label="Previous month with purchases"
                    >
                      <ChevronLeftIcon />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      disabled={!hasNext}
                      onClick={() => stepSelected(1)}
                      aria-label="Next month with purchases"
                    >
                      <ChevronRightIcon />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setPicked(null)}
                      aria-label={`Hide ${formatMonth(selected)} purchases`}
                    >
                      <XIcon />
                    </Button>
                  </div>
                </div>
                <div className="v-table-wrap">
                  <table className="v-table v-month-table">
                    <caption className="sr-only">
                      Purchases in {formatMonthLong(selected)}
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Title</th>
                        <th scope="col" className="v-col-date">
                          Bought
                        </th>
                        <th scope="col" className="v-num v-col-list">
                          List price
                        </th>
                        <th scope="col" className="v-num">
                          Discount
                        </th>
                        <th scope="col" className="v-num">
                          Paid
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((line, idx) => (
                        <tr key={`${line.title}-${line.date}-${idx}`}>
                          <td className="v-cell-title">
                            <span className="v-title">
                              <SteamThumb
                                appId={line.appId}
                                name={line.title}
                                artwork={artwork}
                              />
                              {line.appId ? (
                                <a
                                  href={steamStoreUrl(line.appId)}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {line.title}
                                  <span className="sr-only"> (opens Steam store)</span>
                                </a>
                              ) : (
                                <span>{line.title}</span>
                              )}
                            </span>
                          </td>
                          <td className="v-col-date v-quiet">
                            {formatDay(line.date)}
                          </td>
                          <td className="v-num v-col-list v-quiet">
                            {line.listAmount != null ? money(line.listAmount) : "—"}
                          </td>
                          <td className="v-num">
                            {line.off != null && line.off > 0 ? `−${line.off}%` : "—"}
                          </td>
                          <td className="v-num v-strong">{money(line.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p className="v-month-empty">
                Select a month to list its purchases with price paid, list
                price and discount.
              </p>
            )}
          </div>
        </>
      ) : null}

      <Cohorts stat={stats?.cohorts ?? null} currency={currency} />

      {spending.paymentMethods.length > 0 || stats?.discountDepth ? (
        <div className="v-panel-foot v-spend-foot">
          {spending.paymentMethods.length > 0 ? (
            <PaymentMix methods={spending.paymentMethods} money={money} />
          ) : null}
          <DiscountDepth stat={stats?.discountDepth ?? null} currency={currency} />
        </div>
      ) : null}
    </section>
  );
}
