import { useId, type ReactNode } from "react";

/**
 * Frame shared by every stat: the question as the title, the answer as a
 * sentence, then the chart, a coverage note and an optional data table.
 */
export function StatBoard(props: {
  /** The question this board answers. */
  title: string;
  /** One-line answer computed from the data. */
  takeaway: ReactNode;
  /** Coverage, as-of date and caveats. */
  note?: ReactNode;
  /** The same data as a table, behind a disclosure. */
  table?: ReactNode;
  wide?: boolean;
  children?: ReactNode;
}) {
  const titleId = useId();
  return (
    <figure
      aria-labelledby={titleId}
      className={`m-0 flex min-w-0 flex-col gap-4 rounded-2xl border border-border bg-card p-4 sm:p-5 ${
        props.wide ? "lg:col-span-2" : ""
      }`}
    >
      <header className="flex flex-col gap-1.5">
        <h3
          id={titleId}
          className="m-0 text-[1.1rem] font-semibold leading-snug tracking-tight text-foreground"
        >
          {props.title}
        </h3>
        <p className="m-0 max-w-[68ch] text-sm leading-relaxed text-foreground/90">
          {props.takeaway}
        </p>
      </header>
      {props.children}
      {props.note ? (
        <figcaption className="max-w-[80ch] text-xs leading-relaxed text-muted-foreground">
          {props.note}
        </figcaption>
      ) : null}
      {props.table ? (
        <details className="text-xs">
          <summary className="w-fit cursor-pointer rounded-sm py-1 text-xs text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Show the numbers as a table
          </summary>
          <div className="mt-2 max-h-80 overflow-auto rounded-md border border-border">
            {props.table}
          </div>
        </details>
      ) : null}
    </figure>
  );
}

/** Board shown when a stat is null: says what is missing and how to get it. */
export function MissingBoard(props: {
  title: string;
  missing: string;
  /** Shell command that would fetch the missing data. */
  command?: string;
  wide?: boolean;
}) {
  return (
    <StatBoard
      title={props.title}
      wide={props.wide}
      takeaway={
        <span className="text-muted-foreground">
          Not enough data to answer this yet.
        </span>
      }
    >
      <p className="m-0 text-sm leading-relaxed text-muted-foreground">
        {props.missing}
        {props.command ? (
          <>
            {" "}
            Run{" "}
            <code className="rounded-sm bg-secondary px-1.5 py-0.5 font-mono text-xs text-foreground">
              {props.command}
            </code>{" "}
            to fetch it.
          </>
        ) : null}
      </p>
    </StatBoard>
  );
}

/** Plain data table used inside a board's disclosure. */
export function DataTable(props: {
  caption: string;
  head: string[];
  rows: (string | number)[][];
}) {
  return (
    <table className="w-full border-collapse text-left text-xs">
      <caption className="sr-only">{props.caption}</caption>
      <thead>
        <tr>
          {props.head.map((h, i) => (
            <th
              key={h}
              scope="col"
              className={`sticky top-0 border-b border-border bg-popover px-2.5 py-1.5 text-xs font-semibold tracking-normal normal-case text-muted-foreground ${
                i === 0 ? "" : "text-right"
              }`}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {props.rows.map((row, r) => (
          <tr key={r} className="border-b border-border/60 last:border-b-0">
            {row.map((cell, i) =>
              i === 0 ? (
                <th
                  key={i}
                  scope="row"
                  className="max-w-[16rem] truncate border-b-0 bg-transparent px-2.5 py-1.5 text-xs font-normal tracking-normal normal-case text-foreground"
                >
                  {cell}
                </th>
              ) : (
                <td
                  key={i}
                  className="whitespace-nowrap border-b-0 px-2.5 py-1.5 text-right font-mono tabular-nums text-foreground"
                >
                  {cell}
                </td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
