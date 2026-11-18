"use client";

import { useDeferredValue, useMemo, type Ref } from "react";
import {
  GalleryHorizontalEndIcon,
  InfoIcon,
  LayoutGridIcon,
  ListIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import type { DashboardPayload } from "@/lib/analytics/contracts";
import { formatDay, formatHours } from "@/components/library/format";
import {
  filterRows,
  isRecent,
  isUnplayed,
  sortRows,
  type LibraryFilters,
  type LibraryLayout,
  type LibrarySort,
  type ShelfRow,
} from "@/components/library/model";
import { PlaytimePanorama } from "@/components/library/PlaytimePanorama";
import { ShelfGrid } from "@/components/library/ShelfGrid";
import { ShelfTable } from "@/components/library/ShelfTable";
import type { UrlPatch } from "@/components/library/use-url-state";
import { StatsSection } from "@/components/stats";
import { formatPlayHours } from "@/lib/steam/artwork";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

function Chip({
  pressed,
  onToggle,
  count,
  children,
}: {
  pressed: boolean;
  onToggle: () => void;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="chip"
      aria-pressed={pressed}
      onClick={onToggle}
    >
      {children}
      <span className="chip-count mono">{count}</span>
    </button>
  );
}

export function GameLibrary({
  data,
  rows,
  sort,
  layout,
  filters,
  query,
  onQueryChange,
  onPatch,
  searchInputRef,
  onOpenGlossary,
  onOpenGame,
}: {
  data: DashboardPayload;
  /** Every shelf title in rank order (most hours first). */
  rows: ShelfRow[];
  sort: LibrarySort;
  layout: LibraryLayout;
  filters: LibraryFilters;
  query: string;
  onQueryChange: (query: string) => void;
  onPatch: (patch: UrlPatch) => void;
  searchInputRef?: Ref<HTMLInputElement>;
  onOpenGlossary: (termId?: string) => void;
  onOpenGame: (appId: number) => void;
}) {
  const { playtime, meta, artwork } = data;
  const total = rows.length;
  const currency = data.valuation.currency || data.spending.currency;

  const counts = useMemo(() => {
    let unplayed = 0;
    let family = 0;
    let recent = 0;
    for (const { game } of rows) {
      if (isUnplayed(game)) unplayed += 1;
      if (game.fromFamily) family += 1;
      if (isRecent(game)) recent += 1;
    }
    return { unplayed, played: rows.length - unplayed, family, recent };
  }, [rows]);

  const sorted = useMemo(() => sortRows(rows, sort), [rows, sort]);
  const deferredQuery = useDeferredValue(query);
  const visible = useMemo(
    () => filterRows(sorted, deferredQuery, filters),
    [sorted, deferredQuery, filters],
  );

  const maxHours = rows[0]?.game.hoursForever || 1;
  const top = rows[0] && !isUnplayed(rows[0].game) ? rows[0] : null;
  const topLast = top ? formatDay(top.game.lastPlayedAt) : null;
  const showValue = useMemo(() => rows.some((r) => r.value != null), [rows]);

  // The Account Data games page can list fewer titles than the account owns.
  const partialLibrary = playtime.source === "account-data-html";
  const filtersActive =
    filters.played !== "all" || filters.family || filters.recent;
  const narrowed = filtersActive || query.trim() !== "";
  const isPanorama = layout === "panorama";

  const clearAll = () => {
    onQueryChange("");
    onPatch({ played: "all", family: false, recent: false, query: "" });
  };

  return (
    <div className="library">
      <div className="library-bar">
        <div className="library-summary">
          <h2 id="library-title" tabIndex={-1}>
            Library
          </h2>
          <p className="library-stats">
            <span>
              <span className="mono">{total}</span> titles
            </span>
            <span>
              <span className="mono">{playtime.gamesPlayed}</span> played
            </span>
            <span>
              <span className="mono" data-testid="kpi-total-hours">
                {formatPlayHours(playtime.totalHours)}
              </span>{" "}
              hours
            </span>
          </p>
          {top ? (
            <button
              type="button"
              className="library-top"
              onClick={() => onOpenGame(top.game.appId)}
            >
              <span className="library-top-label">Most played</span>
              <span className="library-top-name">{top.game.name}</span>
              <span>
                <span className="mono">
                  {formatHours(top.game.hoursForever)}
                </span>{" "}
                h
              </span>
              {topLast ? (
                <span className="library-top-last">last {topLast}</span>
              ) : null}
            </button>
          ) : null}
          {partialLibrary ? (
            <button
              type="button"
              className="library-partial"
              onClick={() => onOpenGlossary("partial-library")}
            >
              <InfoIcon aria-hidden />
              Partial snapshot
            </button>
          ) : null}
        </div>

        <ToggleGroup
          value={[layout]}
          onValueChange={(next) => {
            const v = next[0] as LibraryLayout | undefined;
            if (v) onPatch({ layout: v });
          }}
          variant="outline"
          size="sm"
          spacing={0}
          aria-label="Library view"
          className="view-switch"
        >
          <ToggleGroupItem value="grid" aria-label="Grid view">
            <LayoutGridIcon aria-hidden />
            <span className="view-switch-label">Grid</span>
          </ToggleGroupItem>
          <ToggleGroupItem value="list" aria-label="List view">
            <ListIcon aria-hidden />
            <span className="view-switch-label">List</span>
          </ToggleGroupItem>
          <ToggleGroupItem value="panorama" aria-label="Panorama view">
            <GalleryHorizontalEndIcon aria-hidden />
            <span className="view-switch-label">Panorama</span>
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {total === 0 ? (
        <div className="state-block">
          <h3>No games on the shelf yet</h3>
          <p>
            Steam Stats reads your library from a local Account Data fetch. Run
            this from the project folder, sign in to Steam in the window that
            opens, then reload this page.
          </p>
          <pre className="state-command">
            <code className="mono">npm run launch</code>
          </pre>
        </div>
      ) : isPanorama ? (
        <PlaytimePanorama
          games={playtime.games}
          artwork={artwork}
          onOpenGame={onOpenGame}
        />
      ) : (
        <>
          <div className="library-controls" role="search" aria-label="Shelf">
            <div className="search-field">
              <SearchIcon aria-hidden />
              <Input
                ref={searchInputRef}
                type="search"
                placeholder="Search titles"
                value={query}
                onChange={(e) => onQueryChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Escape") return;
                  if (query) onQueryChange("");
                  else e.currentTarget.blur();
                }}
                aria-label="Search games"
                autoComplete="off"
                spellCheck={false}
              />
              {query ? (
                <button
                  type="button"
                  className="search-clear"
                  aria-label="Clear search"
                  onClick={() => onQueryChange("")}
                >
                  <XIcon aria-hidden />
                </button>
              ) : (
                <kbd aria-hidden>/</kbd>
              )}
            </div>

            <div className="chip-row" role="group" aria-label="Filter titles">
              <Chip
                pressed={filters.played === "played"}
                count={counts.played}
                onToggle={() =>
                  onPatch({
                    played: filters.played === "played" ? "all" : "played",
                  })
                }
              >
                Played
              </Chip>
              <Chip
                pressed={filters.played === "unplayed"}
                count={counts.unplayed}
                onToggle={() =>
                  onPatch({
                    played: filters.played === "unplayed" ? "all" : "unplayed",
                  })
                }
              >
                Unplayed
              </Chip>
              {counts.family > 0 || filters.family ? (
                <Chip
                  pressed={filters.family}
                  count={counts.family}
                  onToggle={() => onPatch({ family: !filters.family })}
                >
                  Family
                </Chip>
              ) : null}
              {counts.recent > 0 || filters.recent ? (
                <Chip
                  pressed={filters.recent}
                  count={counts.recent}
                  onToggle={() => onPatch({ recent: !filters.recent })}
                >
                  Past 2 weeks
                </Chip>
              ) : null}
            </div>

            <div className="library-controls-end">
              <div className="library-result">
                <p
                  className="library-count"
                  aria-live="polite"
                  aria-atomic="true"
                >
                  {narrowed ? (
                    <>
                      <span className="mono">{visible.length}</span> of{" "}
                      <span className="mono">{total}</span> titles
                    </>
                  ) : (
                    <>
                      <span className="mono">{total}</span> titles
                    </>
                  )}
                </p>
                {narrowed ? (
                  <button
                    type="button"
                    className="text-link"
                    onClick={clearAll}
                  >
                    Clear
                  </button>
                ) : null}
              </div>

              <div className="sort-control">
                <span className="sort-control-label" id="sort-label">
                  Sort
                </span>
                <ToggleGroup
                  value={[sort]}
                  onValueChange={(next) => {
                    const v = next[0] as LibrarySort | undefined;
                    if (v) onPatch({ sort: v });
                  }}
                  variant="outline"
                  size="sm"
                  spacing={0}
                  aria-labelledby="sort-label"
                >
                  <ToggleGroupItem value="hours">Hours</ToggleGroupItem>
                  <ToggleGroupItem value="recent">Recent</ToggleGroupItem>
                  <ToggleGroupItem value="name">A–Z</ToggleGroupItem>
                </ToggleGroup>
              </div>
            </div>
          </div>

          {visible.length === 0 ? (
            <div className="state-block">
              <h3>No titles match</h3>
              <p>
                {query.trim()
                  ? `Nothing on the shelf matches “${query.trim()}”${filtersActive ? " with the current filters" : ""}.`
                  : "No title passes the current filters."}
              </p>
              <Button type="button" variant="outline" onClick={clearAll}>
                Clear search and filters
              </Button>
            </div>
          ) : layout === "list" ? (
            <ShelfTable
              rows={visible}
              sort={sort}
              onSort={(next) => onPatch({ sort: next })}
              maxHours={maxHours}
              currency={currency}
              showValue={showValue}
              artwork={artwork}
              onOpen={onOpenGame}
            />
          ) : (
            <ShelfGrid
              rows={visible}
              sort={sort}
              maxHours={maxHours}
              artwork={artwork}
              onOpen={onOpenGame}
            />
          )}
        </>
      )}

      <div className="library-stats-mount">
        <StatsSection
          tab="library"
          stats={data.stats}
          currency={currency}
          artwork={artwork}
          sourceStatus={meta.sourceStatus ?? null}
        />
      </div>
    </div>
  );
}
