"use client";

import { memo } from "react";
import { SteamArt } from "@/components/SteamArt";
import { formatDay, formatHours } from "@/components/library/format";
import {
  isRecent,
  isUnplayed,
  type LibrarySort,
  type ShelfRow,
} from "@/components/library/model";
import type { ArtworkUrls } from "@/lib/steam/artwork-resolve";

/** Cards in the first rows load eagerly; the rest are lazy. */
const EAGER_CARDS = 6;

export function gameSummary(row: ShelfRow): string {
  const { game } = row;
  const parts = [
    game.name,
    isUnplayed(game) ? "unplayed" : `${formatHours(game.hoursForever)} hours`,
  ];
  const last = formatDay(game.lastPlayedAt);
  if (last) parts.push(`last played ${last}`);
  if (game.fromFamily) parts.push("Family Library");
  return parts.join(", ");
}

const ShelfCard = memo(function ShelfCard({
  row,
  showRank,
  maxHours,
  artwork,
  priority,
  onOpen,
}: {
  row: ShelfRow;
  showRank: boolean;
  maxHours: number;
  artwork?: Record<string, ArtworkUrls>;
  priority: boolean;
  onOpen: (appId: number) => void;
}) {
  const { game } = row;
  const unplayed = isUnplayed(game);
  const fill = maxHours > 0 ? Math.min(1, game.hoursForever / maxHours) : 0;
  const last = formatDay(game.lastPlayedAt);
  const added = last ? null : formatDay(game.addedAt);

  return (
    <li>
      <button
        type="button"
        className="shelf-card"
        data-testid="game-card"
        data-app-id={game.appId}
        aria-label={`${gameSummary(row)}. Open details`}
        onClick={() => onOpen(game.appId)}
      >
        <span className="shelf-card-art">
          <SteamArt
            appId={game.appId}
            name={game.name}
            artwork={artwork}
            variant="portrait"
            framed={false}
            alt=""
            sizes="(max-width: 640px) 31vw, (max-width: 1100px) 160px, 172px"
            priority={priority}
          />
        </span>
        <span className="shelf-card-meter" aria-hidden>
          <span style={{ ["--fill" as string]: fill }} />
        </span>
        <span className="shelf-card-stat">
          {showRank ? (
            <span className="shelf-card-rank mono">{row.rank}</span>
          ) : null}
          {unplayed ? (
            <span className="shelf-card-unplayed">Unplayed</span>
          ) : (
            <span className="shelf-card-hours">
              <span className="mono">{formatHours(game.hoursForever)}</span> h
            </span>
          )}
          {last ? (
            <span className="shelf-card-date">{last}</span>
          ) : added ? (
            <span className="shelf-card-date">Added {added}</span>
          ) : null}
        </span>
        <span className="shelf-card-name">{game.name}</span>
        {game.fromFamily || isRecent(game) ? (
          <span className="shelf-card-tags">
            {game.fromFamily ? <span className="tag">Family</span> : null}
            {isRecent(game) ? (
              <span className="tag tag-live">
                <span className="mono">{formatHours(game.hours2Weeks ?? 0)}</span>{" "}
                h in 2 weeks
              </span>
            ) : null}
          </span>
        ) : null}
      </button>
    </li>
  );
});

export function ShelfGrid({
  rows,
  sort,
  maxHours,
  artwork,
  onOpen,
}: {
  rows: ShelfRow[];
  sort: LibrarySort;
  maxHours: number;
  artwork?: Record<string, ArtworkUrls>;
  onOpen: (appId: number) => void;
}) {
  return (
    <ul className="shelf-grid" aria-label="Games">
      {rows.map((row, i) => (
        <ShelfCard
          key={row.game.appId}
          row={row}
          showRank={sort === "hours"}
          maxHours={maxHours}
          artwork={artwork}
          priority={i < EAGER_CARDS}
          onOpen={onOpen}
        />
      ))}
    </ul>
  );
}
