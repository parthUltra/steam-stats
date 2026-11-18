"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { money, moneyCompact, monthLabel } from "./format";

export type StepPoint = {
  /** "YYYY-MM" */
  month: string;
  /** Running total, drawn as a step line. */
  step: number;
  /** This month's own amount, drawn as bars underneath. */
  bar: number;
};

type Unit = { kind: "money"; currency: string } | { kind: "count" };

const TICK = {
  fill: "var(--muted-foreground)",
  fontSize: 12,
  fontFamily: "var(--font-mono), ui-monospace, monospace",
};
const AXIS_WIDTH = 52;
const MARGIN = { top: 8, right: 12, bottom: 0, left: 0 };

function fmt(unit: Unit, n: number, compact = false): string {
  if (unit.kind === "count") return Math.round(n).toLocaleString("en-US");
  return compact ? moneyCompact(n, unit.currency) : money(n, unit.currency);
}

function Tip(props: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: StepPoint }>;
  unit: Unit;
  stepName: string;
  barName: string;
}) {
  const point = props.payload?.[0]?.payload;
  if (!props.active || !point) return null;
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground">
      <div className="mb-1 text-sm font-semibold">{monthLabel(point.month)}</div>
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">{props.barName}</span>
        <span className="font-mono tabular-nums">{fmt(props.unit, point.bar)}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">{props.stepName}</span>
        <span className="font-mono tabular-nums">{fmt(props.unit, point.step)}</span>
      </div>
    </div>
  );
}

/**
 * A running total as a step line (events are discrete, so no smoothing) over
 * per-month bars. Two panels sharing the x axis — never a second y axis.
 */
export function StepChart(props: {
  points: StepPoint[];
  unit: Unit;
  /** Token colour for both panels, e.g. "var(--amber)". */
  color: string;
  stepName: string;
  barName: string;
  /** Text alternative read in place of the drawing. */
  summary: string;
}) {
  const { points, unit } = props;
  // One tick per January, plus the first month when the series starts mid-year.
  const januaries = points.filter((p) => p.month.endsWith("-01")).map((p) => p.month);
  const ticks =
    points.length && !points[0].month.endsWith("-01") && points.length <= 6
      ? [points[0].month, ...januaries]
      : januaries.length
        ? januaries
        : points.slice(0, 1).map((p) => p.month);
  const yearOf = (m: string) => m.slice(0, 4);
  const tip = (
    <Tip unit={unit} stepName={props.stepName} barName={props.barName} />
  );

  return (
    <div role="group" aria-label={props.summary} className="flex flex-col gap-1">
      <p className="m-0 text-xs text-muted-foreground">{props.stepName}</p>
      <div className="h-[200px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={MARGIN} syncId="step" title={props.summary}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="month"
              ticks={ticks}
              tickFormatter={yearOf}
              tick={TICK}
              tickLine={false}
              axisLine={{ stroke: "var(--line-hot)" }}
              interval={0}
            />
            <YAxis
              width={AXIS_WIDTH}
              tick={TICK}
              tickLine={false}
              axisLine={false}
              domain={[0, "auto"]}
              tickCount={5}
              allowDecimals={false}
              tickFormatter={(v: number) => fmt(unit, v, true)}
            />
            <Tooltip content={tip} cursor={{ stroke: "var(--line-hot)" }} />
            <Line
              type="stepAfter"
              dataKey="step"
              stroke={props.color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: props.color, stroke: "var(--foreground)" }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="m-0 mt-2 text-xs text-muted-foreground">{props.barName}</p>
      <div className="h-[104px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={points} margin={MARGIN} syncId="step" title={props.barName}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="month"
              ticks={ticks}
              tickFormatter={yearOf}
              tick={TICK}
              tickLine={false}
              axisLine={{ stroke: "var(--line-hot)" }}
              interval={0}
            />
            <YAxis
              width={AXIS_WIDTH}
              tick={TICK}
              tickLine={false}
              axisLine={false}
              domain={[0, "auto"]}
              tickCount={3}
              allowDecimals={false}
              tickFormatter={(v: number) => fmt(unit, v, true)}
            />
            <Tooltip content={tip} cursor={{ fill: "var(--secondary)" }} />
            <Bar
              dataKey="bar"
              fill={props.color}
              radius={[2, 2, 0, 0]}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
