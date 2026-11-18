"use client";

import { memo } from "react";
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import { SteamArt } from "@/components/SteamArt";
import {
  formatDay,
  formatHours,
  formatMoney,
  formatMoneyPerHour,
} from "@/components/library/format";
import { gameSummary } from "@/components/library/ShelfGrid";
import {
  isRecent,
  isUnplayed,
  type LibrarySort,
  type ShelfRow,
} from "@/components/library/model";
import type { ArtworkUrls } from "@/lib/steam/artwork-resolve";

const DASH = <span className="shelf-table-none">—</span>;

const TableRow = memo(function TableRow({
  row,
  maxHours,
  currency,
  showValue,
  artwork,
  onOpen,
}: {
  row: ShelfRow;
  maxHours: number;
  currency: string;
  showValue: boolean;
  artwork?: Record<string, ArtworkUrls>;
  onOpen: (appId: number) => void;
}) {
  const { game, value } = row;
  const unplayed = isUnplayed(game);
  const fill = maxHours > 0 ? Math.min(1, game.hoursForever / maxHours) : 0;
  const last = formatDay(game.lastPlayedAt);

  return (
    <tr
      data-testid="game-card"
      data-app-id={game.appId}
      onClick={() => onOpen(game.appId)}
    >
      <td className="col-rank mono">{row.rank}</td>
      <th scope="row" className="col-title">
        <div className="shelf-row-title">
          <button
            type="button"
            className="shelf-row-open"
            aria-label={`${gameSummary(row)}. Open details`}
            onClick={(e) => {
              e.stopPropagation();
              onOpen(game.appId);
            }}
          >
            <span className="shelf-row-art">
              <SteamArt
                appId={game.appId}
                name={game.name}
                artwork={artwork}
                variant="capsule"
                framed={false}
                alt=""
              />
            </span>
            <span className="shelf-row-name">{game.name}</span>
          </button>
          {game.fromFamily ? <span className="tag">Family</span> : null}
        </div>
      </th>
      <td className="col-hours num">
        {unplayed ? (
          <span className="shelf-table-quiet">Unplayed</span>
        ) : (
          <>
            <span className="mono">{formatHours(game.hoursForever)}</span>
            <span className="shelf-row-meter" aria-hidden>
              <span style={{ ["--fill" as string]: fill }} />
            </span>
          </>
        )}
      </td>
      <td className="col-last">{last ?? DASH}</td>
      <td className="col-recent num">
        {isRecent(game) ? (
          <span className="mono">{formatHours(game.hours2Weeks ?? 0)}</span>
        ) : (
          DASH
        )}
      </td>
      {showValue ? (
        <>
          <td className="col-paid num">
            {value?.paid != null ? (
              <span className="mono">{formatMoney(value.paid, currency)}</span>
            ) : (
              DASH
            )}
          </td>
          <td className="col-shelf num">
            {value?.current != null ? (
              <span className="mono">
                {formatMoney(value.current, currency)}
              </span>
            ) : (
              DASH
            )}
          </td>
          <td className="col-cph num">
            {value?.costPerHour != null ? (
              <span className="mono">
                {formatMoneyPerHour(value.costPerHour, currency)}
              </span>
            ) : (
              DASH
            )}
          </td>
        </>
      ) : null}
    </tr>
  );
});

function SortHeader({
  label,
  sortKey,
  direction,
  sort,
  onSort,
  className,
}: {
  label: string;
  sortKey: LibrarySort;
  direction: "ascending" | "descending";
  sort: LibrarySort;
  onSort: (sort: LibrarySort) => void;
  className?: string;
}) {
  const active = sort === sortKey;
  const Icon = direction === "ascending" ? ArrowUpIcon : ArrowDownIcon;
  return (
    <th
      scope="col"
      className={className}
      aria-sort={active ? direction : undefined}
    >
      <button
        type="button"
        className="shelf-th-sort"
        data-active={active ? "true" : undefined}
        onClick={() => onSort(sortKey)}
      >
        {label}
        <Icon aria-hidden />
      </button>
    </th>
  );
}

export function ShelfTable({
  rows,
  sort,
  onSort,
  maxHours,
  currency,
  showValue,
  artwork,
  onOpen,
}: {
  rows: ShelfRow[];
  sort: LibrarySort;
  onSort: (sort: LibrarySort) => void;
  maxHours: number;
  currency: string;
  /** Money columns appear only when the payload has valuation rows. */
  showValue: boolean;
  artwork?: Record<string, ArtworkUrls>;
  onOpen: (appId: number) => void;
}) {
  return (
    <div className="shelf-table-wrap">
      <table className="shelf-table">
        <caption className="sr-only">
          Library titles with playtime{showValue ? " and value" : ""}
        </caption>
        <thead>
          <tr>
            <th scope="col" className="col-rank">
              <abbr title="Rank by lifetime hours">#</abbr>
            </th>
            <SortHeader
              label="Title"
              sortKey="name"
              direction="ascending"
              sort={sort}
              onSort={onSort}
              className="col-title"
            />
            <SortHeader
              label="Hours"
              sortKey="hours"
              direction="descending"
              sort={sort}
              onSort={onSort}
              className="col-hours num"
            />
            <SortHeader
              label="Last played"
              sortKey="recent"
              direction="descending"
              sort={sort}
              onSort={onSort}
              className="col-last"
            />
            <th scope="col" className="col-recent num">
              2 weeks
            </th>
            {showValue ? (
              <>
                <th scope="col" className="col-paid num">
                  Paid
                </th>
                <th scope="col" className="col-shelf num">
                  Shelf now
                </th>
                <th scope="col" className="col-cph num">
                  Per hour
                </th>
              </>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <TableRow
              key={row.game.appId}
              row={row}
              maxHours={maxHours}
              currency={currency}
              showValue={showValue}
              artwork={artwork}
              onOpen={onOpen}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
