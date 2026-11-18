import type { ReactNode } from "react";

/** Fixed meanings — see DESIGN.md. `steam` is the default for hours/counts. */
export type Tone = "steam" | "amber" | "cyan" | "rose" | "volt" | "muted";

export const TONE_BG: Record<Tone, string> = {
  steam: "bg-primary",
  amber: "bg-(--amber)",
  cyan: "bg-(--cyan)",
  rose: "bg-(--rose)",
  volt: "bg-(--volt)",
  muted: "bg-muted-foreground",
};

export type BarItem = {
  key: string;
  label: ReactNode;
  /** Secondary text after the label (kept quiet). */
  detail?: ReactNode;
  /** Bar length, in the same unit as `max`. */
  value: number;
  /** The value as text — every bar is directly labelled. */
  display: string;
  /** Word after the number ("games"), set in the UI face, not mono. */
  unit?: string;
  tone?: Tone;
  /** Dashed outline instead of a fill: "we do not know" rather than a value. */
  hollow?: boolean;
};

/**
 * Horizontal bars from a zero baseline, label and value on the line above the
 * bar so long names never squeeze the bar at phone width.
 */
export function BarList(props: {
  items: BarItem[];
  /** Scale maximum; defaults to the largest value. */
  max?: number;
  ordered?: boolean;
  label: string;
}) {
  const max = props.max ?? Math.max(...props.items.map((i) => i.value), 0);
  const List = props.ordered ? "ol" : "ul";
  return (
    <List aria-label={props.label} className="m-0 flex list-none flex-col gap-2.5 p-0">
      {props.items.map((item) => {
        const width = max > 0 ? Math.max(0, Math.min(1, item.value / max)) : 0;
        return (
          <li key={item.key} className="flex min-w-0 flex-col gap-1">
            <div className="flex min-w-0 items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-sm text-foreground">
                {item.label}
                {item.detail ? (
                  <span className="text-xs text-muted-foreground"> · {item.detail}</span>
                ) : null}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                <span className="font-mono text-sm tabular-nums text-foreground">
                  {item.display}
                </span>
                {item.unit ? ` ${item.unit}` : null}
              </span>
            </div>
            <div aria-hidden className="h-2 w-full rounded-full bg-secondary">
              {item.value > 0 ? (
                <div
                  className={`h-full min-w-[3px] rounded-full ${
                    item.hollow
                      ? "border border-dashed border-muted-foreground bg-transparent"
                      : TONE_BG[item.tone ?? "steam"]
                  }`}
                  style={{ width: `${width * 100}%` }}
                />
              ) : null}
            </div>
          </li>
        );
      })}
    </List>
  );
}

/** A small labelled figure: mono number, quiet caption. Not a hero metric. */
export function Figure(props: {
  value: string;
  /** Word after the number, set in the UI face. */
  unit?: string;
  label: ReactNode;
  tone?: Tone;
}) {
  const color =
    props.tone === "amber"
      ? "text-(--amber)"
      : props.tone === "rose"
        ? "text-(--rose)"
        : props.tone === "volt"
          ? "text-(--volt)"
          : props.tone === "cyan"
            ? "text-(--cyan)"
            : "text-foreground";
  return (
    <div className="flex min-w-0 flex-col-reverse justify-end gap-0.5">
      <dt className="text-xs leading-snug text-muted-foreground">{props.label}</dt>
      <dd className={`m-0 font-mono text-xl font-medium tabular-nums ${color}`}>
        {props.value}
        {props.unit ? (
          <span className="font-sans text-sm font-normal text-muted-foreground">
            {" "}
            {props.unit}
          </span>
        ) : null}
      </dd>
    </div>
  );
}
