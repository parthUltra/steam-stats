"use client";

import {
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  usePlotArea,
  XAxis,
  YAxis,
} from "recharts";
import {
  estimateTextWidth,
  markerBox,
  placeLabels,
  type Rect,
} from "./label-placement";
import { hours, money, moneyCompact, moneyPerHour } from "./format";

import { logPosition, logTicks } from "./scale";

/** Ring drawn around the point whose table row is hovered or focused. */
function ActiveRing(props: { cx?: number; cy?: number }) {
  if (props.cx == null || props.cy == null) return null;
  return (
    <circle
      cx={props.cx}
      cy={props.cy}
      r={9}
      fill="none"
      stroke="var(--foreground)"
      strokeWidth={2}
      pointerEvents="none"
    />
  );
}

export type MapPoint = {
  title: string;
  paid: number;
  hours: number;
  rate: number;
  /** Short name drawn next to highlighted points; empty otherwise. */
  label: string;
};

const TICK = {
  fill: "var(--muted-foreground)",
  fontSize: 12,
  fontFamily: "var(--font-mono), ui-monospace, monospace",
};

function Tip(props: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: MapPoint }>;
  currency: string;
}) {
  const p = props.payload?.[0]?.payload;
  if (!props.active || !p) return null;
  const row = "flex justify-between gap-4";
  return (
    <div className="max-w-[16rem] rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground">
      <div className="mb-1 text-sm font-semibold">{p.title}</div>
      <div className={row}>
        <span className="text-muted-foreground">Paid</span>
        <span className="font-mono tabular-nums">{money(p.paid, props.currency)}</span>
      </div>
      <div className={row}>
        <span className="text-muted-foreground">Played</span>
        <span className="font-mono tabular-nums">{hours(p.hours)}</span>
      </div>
      <div className={row}>
        <span className="text-muted-foreground">Cost per hour</span>
        <span className="font-mono tabular-nums">
          {moneyPerHour(p.rate, props.currency)}
        </span>
      </div>
    </div>
  );
}

/**
 * Pixels kept clear between the outermost marker and the plot edge. The axes
 * must not set `allowDataOverflow`: it clips marks to the padded range, which
 * cuts a marker sitting on the first or last tick in half.
 */
const EDGE = 10;
const MARKER_RADIUS = 7;
const LABEL_HEIGHT = 15;

/**
 * Names for the highlighted points, placed so that no label touches another
 * label, any marker, a diagonal's rate, or the plot edge. A label that cannot
 * be placed is left out; its point still answers to the tooltip and the table.
 */
function MapLabels(props: {
  /** Highest priority first. */
  labelled: MapPoint[];
  all: MapPoint[];
  xDomain: [number, number];
  yDomain: [number, number];
  rateLabels: { x: number; y: number; text: string }[];
}) {
  const plot = usePlotArea();
  if (!plot || plot.width <= 2 * EDGE || plot.height <= 2 * EDGE) return null;
  const px = (hoursPlayed: number) =>
    plot.x + EDGE + logPosition(hoursPlayed, ...props.xDomain) * (plot.width - 2 * EDGE);
  const py = (paid: number) =>
    plot.y + EDGE + (1 - logPosition(paid, ...props.yDomain)) * (plot.height - 2 * EDGE);

  const obstacles: Rect[] = [
    ...props.all.map((p) => markerBox(px(p.hours), py(p.paid), MARKER_RADIUS)),
    // Rate captions sit inside the top-right end of each diagonal.
    ...props.rateLabels.map((r) => {
      const width = estimateTextWidth(r.text);
      return { x: px(r.x) - width - 4, y: py(r.y), width: width + 4, height: 20 };
    }),
  ];
  const { placed } = placeLabels({
    labels: props.labelled.map((p) => ({
      id: p.title,
      x: px(p.hours),
      y: py(p.paid),
      width: estimateTextWidth(p.label),
      height: LABEL_HEIGHT,
    })),
    bounds: { x: plot.x, y: plot.y, width: plot.width, height: plot.height },
    obstacles,
  });
  const textOf = new Map(props.labelled.map((p) => [p.title, p.label]));

  return (
    <g aria-hidden pointerEvents="none">
      {placed.map((l) => (
        <text
          key={l.id}
          x={l.rect.x + l.rect.width / 2}
          y={l.rect.y + l.rect.height - 4}
          textAnchor="middle"
          fill="var(--foreground)"
          fontSize={12}
        >
          {textOf.get(l.id)}
        </text>
      ))}
    </g>
  );
}

/** Powers of ten (per hour) whose diagonal crosses the plotted box. */
function isoRates(x: [number, number], y: [number, number]) {
  const out: { rate: number; from: { x: number; y: number }; to: { x: number; y: number } }[] = [];
  const lo = Math.ceil(Math.log10(y[0] / x[1]));
  const hi = Math.floor(Math.log10(y[1] / x[0]));
  for (let exp = lo; exp <= hi; exp += 1) {
    const rate = 10 ** exp;
    const from = Math.max(x[0], y[0] / rate);
    const to = Math.min(x[1], y[1] / rate);
    // Skip diagonals that only clip a corner of the plot.
    if (to / from < 4) continue;
    out.push({
      rate,
      from: { x: from, y: rate * from },
      to: { x: to, y: rate * to },
    });
  }
  return out;
}

/**
 * Paid against hours, both on log scales: each axis spans about two orders of
 * magnitude, and on log–log a constant cost per hour is a straight diagonal.
 */
export function ValueMapChart(props: {
  points: MapPoint[];
  steals: MapPoint[];
  regrets: MapPoint[];
  currency: string;
  summary: string;
  /** Title to ring on the map (driven by the table beside it). */
  activeTitle?: string | null;
  /** Called with the title under the pointer, or null when it leaves. */
  onActive?: (title: string | null) => void;
  /** Tailwind height classes; defaults to the standalone board size. */
  heightClass?: string;
}) {
  const all = [...props.points, ...props.steals, ...props.regrets];
  if (!all.length) return null;
  const xTicks = logTicks(
    Math.min(...all.map((p) => p.hours)),
    Math.max(...all.map((p) => p.hours)),
  );
  const yTicks = logTicks(
    Math.min(...all.map((p) => p.paid)),
    Math.max(...all.map((p) => p.paid)),
  );
  // A single value gives one tick; pad the domain so the scale stays valid.
  const span = (ticks: number[]): [number, number] =>
    ticks.length > 1
      ? [ticks[0], ticks[ticks.length - 1]]
      : [ticks[0] / 2, ticks[0] * 2];
  const xDomain = span(xTicks);
  const yDomain = span(yTicks);
  const diagonals = isoRates(xDomain, yDomain);
  // Label priority: best steal, worst regret, second steal, and so on.
  const labelled: MapPoint[] = [];
  for (let i = 0; i < Math.max(props.steals.length, props.regrets.length); i += 1) {
    if (props.steals[i]?.label) labelled.push(props.steals[i]);
    if (props.regrets[i]?.label) labelled.push(props.regrets[i]);
  }
  const active = props.activeTitle
    ? all.filter((p) => p.title === props.activeTitle).slice(0, 1)
    : [];
  const hover = {
    onMouseEnter: (p: { payload?: MapPoint }) =>
      props.onActive?.(p.payload?.title ?? null),
    onMouseLeave: () => props.onActive?.(null),
  };

  return (
    <div
      role="group"
      aria-label={props.summary}
      className={`w-full ${props.heightClass ?? "h-[340px] sm:h-[400px]"}`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart
          margin={{ top: 16, right: 16, bottom: 18, left: 0 }}
          title={props.summary}
        >
          <CartesianGrid stroke="var(--border)" />
          <XAxis
            type="number"
            dataKey="hours"
            name="Hours played"
            scale="log"
            domain={xDomain}
            ticks={xTicks}
            tick={TICK}
            tickLine={false}
            axisLine={{ stroke: "var(--line-hot)" }}
            minTickGap={4}
            padding={{ left: EDGE, right: EDGE }}
            tickFormatter={(v: number) => String(v)}
            label={{
              value: "hours played (log scale)",
              position: "insideBottom",
              offset: -10,
              fill: "var(--muted-foreground)",
              fontSize: 12,
            }}
          />
          <YAxis
            type="number"
            dataKey="paid"
            name="Paid"
            scale="log"
            domain={yDomain}
            ticks={yTicks}
            width={52}
            padding={{ top: EDGE, bottom: EDGE }}
            tick={TICK}
            tickLine={false}
            axisLine={{ stroke: "var(--line-hot)" }}
            tickFormatter={(v: number) => moneyCompact(v, props.currency)}
          />
          {diagonals.map((d) => (
            <ReferenceLine
              key={d.rate}
              segment={[d.from, d.to]}
              stroke="var(--line-hot)"
              strokeDasharray="4 4"
              ifOverflow="visible"
              label={{
                value: `${moneyCompact(d.rate, props.currency)}/h`,
                position: "insideTopRight",
                fill: "var(--muted-foreground)",
                fontSize: 12,
              }}
            />
          ))}
          <Tooltip
            content={<Tip currency={props.currency} />}
            cursor={{ stroke: "var(--line-hot)", strokeDasharray: "3 3" }}
          />
          <Scatter
            name="Paid titles"
            data={props.points}
            fill="var(--steam)"
            fillOpacity={0.8}
            stroke="var(--card)"
            isAnimationActive={false}
            {...hover}
          />
          <Scatter
            name="Paid a lot, played little"
            data={props.regrets}
            fill="var(--rose)"
            stroke="var(--card)"
            shape="diamond"
            isAnimationActive={false}
            {...hover}
          />
          <Scatter
            name="Cheapest hours"
            data={props.steals}
            fill="var(--volt)"
            stroke="var(--card)"
            shape="triangle"
            isAnimationActive={false}
            {...hover}
          />
          <MapLabels
            labelled={labelled}
            all={all}
            xDomain={xDomain}
            yDomain={yDomain}
            rateLabels={diagonals.map((d) => ({
              x: d.to.x,
              y: d.to.y,
              text: `${moneyCompact(d.rate, props.currency)}/h`,
            }))}
          />
          {active.length ? (
            <Scatter
              name="Selected"
              data={active}
              shape={ActiveRing}
              isAnimationActive={false}
            />
          ) : null}
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
