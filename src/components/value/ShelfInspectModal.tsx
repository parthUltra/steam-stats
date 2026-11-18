"use client";

import { useMemo, useState } from "react";
import { XIcon } from "lucide-react";
import { steamStoreUrl } from "@/lib/steam/artwork";
import type { ArtworkUrls } from "@/lib/steam/artwork-resolve";
import { ModalShell } from "@/components/ModalShell";
import { Button } from "@/components/ui/button";
import { formatDay } from "@/components/value/format";
import { SteamThumb } from "@/components/value/SteamThumb";
import {
  nextSort,
  SortTh,
  type SortState,
} from "@/components/value/SortTh";
import {
  buildInspectRows,
  type InspectMode,
  type ValuationGameRow,
} from "@/components/value/inspect-rows";

type SortKey = "title" | "amount";

const COPY: Record<
  InspectMode,
  { title: string; column: string; blurb: string; tone: string }
> = {
  spent: {
    title: "Paid",
    column: "Paid",
    blurb: "What you paid for each title you kept.",
    tone: "amber",
  },
  shelfNow: {
    title: "Shelf now",
    column: "Price now",
    blurb: "Today's Steam store price for each playable title.",
    tone: "cyan",
  },
  lowest: {
    title: "Lowest",
    column: "All-time low",
    blurb:
      "Each title's all-time low on the Steam store. A dash means no low is stored yet.",
    tone: "v-low",
  },
};

const KIND_LABEL: Partial<Record<ValuationGameRow["kind"], string>> = {
  gifted_to_me: "Gift",
  free: "Free",
  bundle: "In a bundle",
};

const byTitle = (a: string, b: string) =>
  a.localeCompare(b, "en", { sensitivity: "base" });

/** Per-title list behind one of the three totals. */
export function ShelfInspectModal({
  mode,
  total,
  games,
  money,
  artwork,
  onClose,
  calibrating,
}: {
  mode: InspectMode;
  total: number;
  games: ValuationGameRow[];
  money: (n: number) => string;
  artwork?: Record<string, ArtworkUrls>;
  onClose: () => void;
  calibrating?: boolean;
}) {
  const copy = COPY[mode];
  const [sort, setSort] = useState<SortState<SortKey>>({
    key: "amount",
    dir: "desc",
  });

  const rows = useMemo(() => {
    const list = buildInspectRows(games, mode, { calibrating });
    const dir = sort.dir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      if (sort.key === "title") return dir * byTitle(a.game.title, b.game.title);
      // Missing amounts always sink to the end.
      if (a.amount == null || b.amount == null) {
        if (a.amount == null && b.amount == null) {
          return byTitle(a.game.title, b.game.title);
        }
        return a.amount == null ? 1 : -1;
      }
      return dir * (a.amount - b.amount) || byTitle(a.game.title, b.game.title);
    });
    return list;
  }, [games, mode, sort, calibrating]);

  /** Lows carry the date they were recorded on newer payloads. */
  const showRecorded =
    mode === "lowest" && rows.some(({ game }) => Boolean(game.lowestRecordedAt));

  const onSort = (key: SortKey) =>
    setSort((s) => nextSort(s, key, key === "title" ? "asc" : "desc"));

  return (
    <ModalShell
      open
      onClose={onClose}
      labelledBy="shelf-inspect-title"
      className="v-dialog-overlay"
      cardClassName="v-dialog"
    >
      <div className="v-dialog-head">
        <div>
          <h3 id="shelf-inspect-title">
            {copy.title}{" "}
            <span className={`mono ${copy.tone}`}>{money(total)}</span>
          </h3>
          <p>
            {copy.blurb}{" "}
            <span className="mono">{rows.length}</span>{" "}
            {rows.length === 1 ? "title" : "titles"}.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          aria-label="Close"
        >
          <XIcon />
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="v-empty">Nothing to show for this total.</p>
      ) : (
        // Focusable so the list scrolls from the keyboard.
        <div
          className="v-dialog-scroll"
          tabIndex={0}
          role="region"
          aria-label={`${copy.title} by title`}
        >
          <table className="v-table v-inspect-table">
            <caption className="sr-only">{copy.title} by title</caption>
            <thead>
              <tr>
                <SortTh k="title" label="Title" sort={sort} onSort={onSort} />
                {showRecorded ? (
                  <th scope="col" className="v-col-date">
                    Low recorded
                  </th>
                ) : null}
                <SortTh
                  k="amount"
                  label={copy.column}
                  sort={sort}
                  onSort={onSort}
                  numeric
                />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ game, amount }) => (
                <tr key={`${game.title}-${game.steamAppId ?? "x"}`}>
                  <td className="v-cell-title">
                    <span className="v-title">
                      <SteamThumb
                        appId={game.steamAppId}
                        name={game.title}
                        artwork={artwork}
                      />
                      {game.steamAppId ? (
                        <a
                          href={steamStoreUrl(game.steamAppId)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {game.title}
                          <span className="sr-only"> (opens Steam store)</span>
                        </a>
                      ) : (
                        <span>{game.title}</span>
                      )}
                      {mode !== "spent" && KIND_LABEL[game.kind] ? (
                        <span className="v-tag">{KIND_LABEL[game.kind]}</span>
                      ) : null}
                    </span>
                  </td>
                  {showRecorded ? (
                    <td className="v-col-date v-quiet">
                      {game.lowestRecordedAt ? formatDay(game.lowestRecordedAt) : "—"}
                    </td>
                  ) : null}
                  <td className="v-num">
                    {amount != null ? money(amount) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ModalShell>
  );
}
