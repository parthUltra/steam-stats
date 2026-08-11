"use client";

import { useMemo, type Ref } from "react";
import { SearchIcon } from "lucide-react";
import type { DashboardPayload } from "@/lib/analytics/dashboard";
import { PlaytimePanorama } from "@/components/PlaytimePanorama";
import { SteamArt } from "@/components/SteamArt";
import type { ArtworkUrls } from "@/lib/steam/artwork-resolve";
import {
  formatPlayHours,
  rankMedalClass,
  steamStoreUrl,
} from "@/lib/steam/artwork";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";

export type LibraryView = "hours" | "recent" | "name" | "panorama";

function GameCard({
  game,
  rank,
  maxHours,
  artwork,
  index = 0,
}: {
  game: DashboardPayload["playtime"]["games"][number];
  rank?: number | null;
  maxHours: number;
  artwork?: Record<string, ArtworkUrls>;
  index?: number;
}) {
  const pct =
    maxHours > 0 ? Math.min(100, (game.hoursForever / maxHours) * 100) : 0;
  const showRank = rank != null && rank > 0;

  return (
    <a
      className="game-card"
      href={steamStoreUrl(game.appId)}
      target="_blank"
      rel="noreferrer"
      style={{ animationDelay: `${Math.min(index, 12) * 40}ms` }}
    >
      <div className="game-card-art">
        <SteamArt
          appId={game.appId}
          name={game.name}
          artwork={artwork}
          variant="portrait"
          className=""
          alt=""
          framed={false}
        />
        <div className="game-card-shade" />
        {showRank ? (
          <div className={`game-card-rank ${rankMedalClass(rank)}`}>
            #{rank}
          </div>
        ) : null}
        <div className="game-card-meta">
          <div className="game-card-hours">
            <span className="game-card-hours-num">
              {formatPlayHours(game.hoursForever)}
            </span>
            <span className="game-card-hours-unit">hrs</span>
          </div>
          {game.lastPlayedText ? (
            <div className="game-card-last">Last {game.lastPlayedText}</div>
          ) : null}
          <div className="game-card-bar" aria-hidden>
            <span style={{ ["--fill" as string]: pct / 100 }} />
          </div>
        </div>
      </div>
      <div className="game-card-name">{game.name}</div>
      <div className="game-card-tags">
        {game.fromFamily ? <Badge variant="secondary">Family</Badge> : null}
        {game.hours2Weeks != null && game.hours2Weeks > 0 ? (
          <Badge variant="outline">
            {formatPlayHours(game.hours2Weeks)}h recent
          </Badge>
        ) : null}
      </div>
    </a>
  );
}

function HeroBanner({
  appId,
  artwork,
  className,
  kind,
  alt,
  name,
}: {
  appId: number;
  artwork?: Record<string, ArtworkUrls>;
  className: string;
  kind: "header" | "library";
  alt?: string;
  name: string;
}) {
  return (
    <SteamArt
      appId={appId}
      name={name}
      artwork={artwork}
      variant={kind === "library" ? "portrait" : "header"}
      className={className}
      alt={alt}
      framed={false}
    />
  );
}

export function GameLibrary({
  data,
  view: viewProp,
  onViewChange,
  query: queryProp,
  onQueryChange,
  searchInputRef,
  onOpenGlossary,
}: {
  data: DashboardPayload;
  view?: LibraryView;
  onViewChange?: (view: LibraryView) => void;
  query?: string;
  onQueryChange?: (query: string) => void;
  searchInputRef?: Ref<HTMLInputElement>;
  onOpenGlossary?: (termId?: string) => void;
}) {
  const { playtime, meta, artwork } = data;
  const query = queryProp ?? "";
  const setQuery = onQueryChange ?? (() => undefined);
  const view = viewProp ?? "hours";
  const setView = onViewChange ?? (() => undefined);

  const maxHours = playtime.games[0]?.hoursForever || 1;
  const hoursRankById = useMemo(() => {
    const map = new Map<number, number>();
    playtime.games.forEach((g, i) => map.set(g.appId, i + 1));
    return map;
  }, [playtime.games]);
  const partialLibrary =
    !meta.hasSteamApiKey && playtime.source === "account-data-html";
  const emptyLibrary = playtime.games.length === 0;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = [...playtime.games];
    if (q) list = list.filter((g) => g.name.toLowerCase().includes(q));
    if (view === "name") {
      list.sort((a, b) => a.name.localeCompare(b.name));
    } else if (view === "recent") {
      list.sort((a, b) => {
        const aAt = a.lastPlayedAt ?? 0;
        const bAt = b.lastPlayedAt ?? 0;
        if (bAt !== aAt) return bAt - aAt;
        const a2 = a.hours2Weeks ?? 0;
        const b2 = b.hours2Weeks ?? 0;
        if (b2 !== a2) return b2 - a2;
        return b.hoursForever - a.hoursForever;
      });
    } else {
      list.sort((a, b) => b.hoursForever - a.hoursForever);
    }
    return list;
  }, [playtime.games, query, view]);

  const featured = query.trim() ? filtered[0] : playtime.games[0];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-xl border border-border/70 bg-card/50 px-4 py-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold tracking-tight">
            Your library shelf
          </h2>
          <p className="text-sm text-muted-foreground">
            {view === "panorama"
              ? "Playtime panorama · capsules sized by hours (30m+)"
              : `${filtered.length} titles · hours on your shelf`}
            {!meta.hasSteamApiKey
              ? " · from Account Data"
              : ` · ${playtime.source}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {view !== "panorama" ? (
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchInputRef}
                className="h-8 w-48 pl-8 md:w-56"
                placeholder="Search games… (/)"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search games"
              />
            </div>
          ) : null}
          <ToggleGroup
            value={[view]}
            onValueChange={(next) => {
              const v = next[0] as LibraryView | undefined;
              if (v) setView(v);
            }}
            variant="outline"
            size="sm"
            spacing={0}
            aria-label="Library view"
          >
            <ToggleGroupItem value="hours">Hours</ToggleGroupItem>
            <ToggleGroupItem value="recent">Recent</ToggleGroupItem>
            <ToggleGroupItem value="name">A–Z</ToggleGroupItem>
            <ToggleGroupItem value="panorama">Panorama</ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

      {partialLibrary ? (
        <Alert>
          <AlertTitle>Partial library snapshot</AlertTitle>
          <AlertDescription>
            <p>
              Showing {playtime.games.length} titles from your Account Data
              games page (often a short list). Refresh Steam data to load the
              full owned set.
            </p>
          </AlertDescription>
        </Alert>
      ) : null}

      {emptyLibrary ? (
        <p className="text-sm text-muted-foreground">
          No games on the shelf yet. Refresh Steam data, then reload.
        </p>
      ) : null}

      {featured && view !== "panorama" && !emptyLibrary ? (
        <section className="library-hero library-hero-compact">
          <HeroBanner
            appId={featured.appId}
            artwork={artwork}
            className="library-hero-bg"
            kind="header"
            name={featured.name}
          />
          <div className="library-hero-veil" />
          <div className="library-hero-content">
            <p className="library-hero-role">
              {query.trim() ? "Top match" : "Most played"}
            </p>
            <h3 className="library-hero-title">{featured.name}</h3>
            <div className="library-hero-featured-stat">
              <span className="library-hero-stat-num">
                {formatPlayHours(featured.hoursForever)}
              </span>
              <span className="library-hero-stat-label">hours on this title</span>
            </div>
            {featured.lastPlayedText ? (
              <p className="library-hero-last">
                Last played {featured.lastPlayedText}
              </p>
            ) : null}
            <Button
              render={
                <a
                  href={steamStoreUrl(featured.appId)}
                  target="_blank"
                  rel="noreferrer"
                />
              }
              nativeButton={false}
              className="mt-1 w-fit"
            >
              View on Steam
            </Button>
          </div>
          <a
            className="library-hero-capsule"
            href={steamStoreUrl(featured.appId)}
            target="_blank"
            rel="noreferrer"
            aria-label={`${featured.name} on Steam`}
          >
            <HeroBanner
              appId={featured.appId}
              artwork={artwork}
              className=""
              kind="library"
              alt={featured.name}
              name={featured.name}
            />
          </a>
        </section>
      ) : null}

      {featured && view !== "panorama" ? (
        <div className="library-account-strip" aria-label="Account playtime">
          <div>
            <span className="library-hero-stat-num">
              {playtime.gamesPlayed}
            </span>
            <span className="library-hero-stat-label">games played</span>
          </div>
          <div className="library-hero-divider" />
          <div>
            <span className="library-hero-stat-num">
              {formatPlayHours(playtime.totalHours)}
            </span>
            <span className="library-hero-stat-label">total hours</span>
          </div>
          <div className="library-hero-divider" />
          <div>
            <span className="library-hero-stat-num">
              {playtime.games.length}
            </span>
            <span className="library-hero-stat-label">titles listed</span>
          </div>
        </div>
      ) : null}

      {view === "panorama" ? (
        <PlaytimePanorama games={playtime.games} artwork={artwork} />
      ) : (
        <>
          <div className="game-grid">
            {filtered.map((game, i) => (
              <GameCard
                key={game.appId}
                game={game}
                rank={view === "hours" ? hoursRankById.get(game.appId) : null}
                index={i}
                maxHours={maxHours}
                artwork={artwork}
              />
            ))}
          </div>

          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No games match that search.
            </p>
          ) : null}
        </>
      )}

      {!partialLibrary ? (
        <p className="text-xs text-muted-foreground">
          {playtime.games.length} titles · {playtime.source}
          {onOpenGlossary ? (
            <>
              {" · "}
              <button
                type="button"
                className="glossary-inline-link"
                onClick={() => onOpenGlossary("shortcuts")}
              >
                Shortcuts
              </button>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
