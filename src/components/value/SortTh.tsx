"use client";

import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon } from "lucide-react";

export type SortDir = "asc" | "desc";
export type SortState<K extends string> = { key: K; dir: SortDir };

/** Flip the direction on the active column, else start at that column's natural direction. */
export function nextSort<K extends string>(
  current: SortState<K>,
  key: K,
  firstDir: SortDir,
): SortState<K> {
  if (current.key === key) {
    return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  }
  return { key, dir: firstDir };
}

/** Column header that sorts. The `th` carries `aria-sort`; the button is the control. */
export function SortTh<K extends string>({
  k,
  label,
  sort,
  onSort,
  numeric,
  className,
}: {
  k: K;
  label: string;
  sort: SortState<K>;
  onSort: (key: K) => void;
  numeric?: boolean;
  className?: string;
}) {
  const active = sort.key === k;
  const Icon = !active
    ? ChevronsUpDownIcon
    : sort.dir === "asc"
      ? ArrowUpIcon
      : ArrowDownIcon;
  return (
    <th
      scope="col"
      aria-sort={
        active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"
      }
      className={[numeric ? "v-num" : "", className ?? ""].join(" ").trim()}
    >
      <button
        type="button"
        className={active ? "v-sort is-active" : "v-sort"}
        onClick={() => onSort(k)}
      >
        <span>{label}</span>
        <Icon aria-hidden />
      </button>
    </th>
  );
}
