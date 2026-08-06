"use client";

import { useEffect, useMemo, useState } from "react";
import { SearchIcon } from "lucide-react";
import type { DashboardPayload } from "@/lib/analytics/dashboard";
import { PlaytimePanorama } from "@/components/PlaytimePanorama";
import { SteamArt, expandedArtCandidates } from "@/components/SteamArt";
import type { ArtworkUrls } from "@/lib/steam/artwork-resolve";
import {
  formatPlayHours,
  rankMedalClass,
  steamStoreUrl,
} from "@/lib/steam/artwork";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";

type LibraryView = "hours" | "recent" | "name" | "panorama";

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
  const candidates = useMemo(
    () => expandedArtCandidates(game.appId, "library", artwork),
    [game.appId, artwork],
  );
  const [srcIdx, setSrcIdx] = useState(0);
  useEffect(() => {
    setSrcIdx(0);
  }, [candidates]);
  const imgFailed = srcIdx >= candidates.length;
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
        {!imgFailed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={candidates[srcIdx]}
            src={candidates[srcIdx]}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setSrcIdx((i) => i + 1)}
          />
        ) : (
          <div className="game-card-fallback">{game.name.slice(0, 1)}</div>
        )}
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
            <span style={{ width: `${pct}%` }} />
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
        ) : (
          <Badge variant="outline" className="text-muted-foreground">
            Lifetime
          </Badge>
        )}
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
}: {
  appId: number;
  artwork?: Record<string, ArtworkUrls>;
  className: string;
  kind: "header" | "library";
  alt?: string;
}) {
  return (
    <SteamArt
      appId={appId}
      name={alt ?? ""}
      artwork={artwork}
      variant={kind === "library" ? "portrait" : "header"}
      className={className}
      alt={alt}
      framed={false}
    />
  );
}

export function GameLibrary({ data }: { data: DashboardPayload }) {
  const { playtime, meta, artwork } = data;
  const [query, setQuery] = useState("");
  const [view, setView] = useState<LibraryView>("hours");

  const maxHours = playtime.games[0]?.hoursForever || 1;
  const featured = playtime.games[0];

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

  return (
    <div className="flex flex-col gap-5">
      {featured ? (
        <section className="library-hero">
          <HeroBanner
            appId={featured.appId}
            artwork={artwork}
            className="library-hero-bg"
            kind="header"
          />
          <div className="library-hero-veil" />
          <div className="library-hero-content">
            <p className="library-hero-kicker">Most played</p>
            <h2 className="library-hero-title">{featured.name}</h2>
            <div className="library-hero-stats">
              <div>
                <span className="library-hero-stat-num">
                  {formatPlayHours(featured.hoursForever)}
                </span>
                <span className="library-hero-stat-label">hours on record</span>
              </div>
              <div className="library-hero-divider" />
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
          >
            <HeroBanner
              appId={featured.appId}
              artwork={artwork}
              className=""
              kind="library"
              alt={featured.name}
            />
          </a>
        </section>
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-4 rounded-xl border border-border/70 bg-card/50 px-4 py-3">
        <div className="flex flex-col gap-1">
          <h3 className="text-lg font-semibold tracking-tight">
            Your library shelf
          </h3>
          <p className="text-sm text-muted-foreground">
            {view === "panorama"
              ? "Playtime panorama · capsules sized by hours (30m+)"
              : `${filtered.length} titles · sorted like a Steam collection wall`}
            {!meta.hasSteamApiKey
              ? " · from Account Data games page"
              : ` · ${playtime.source}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {view !== "panorama" ? (
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-8 w-48 pl-8 md:w-56"
                placeholder="Search games…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
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

      {view === "panorama" ? (
        <PlaytimePanorama games={playtime.games} artwork={artwork} />
      ) : (
        <>
          <div className="game-grid">
            {filtered.map((game, i) => (
              <GameCard
                key={game.appId}
                game={game}
                rank={
                  view === "hours"
                    ? playtime.games.findIndex((g) => g.appId === game.appId) +
                      1
                    : null
                }
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

      {!meta.hasSteamApiKey && playtime.source === "account-data-html" ? (
        <Alert>
          <AlertDescription>
            Showing {playtime.games.length} titles from the games page snapshot
            (often ~25). For your full library, run{" "}
            <code className="font-mono text-primary">
              npm run fetch:owned-games
            </code>{" "}
            after a Steam login session, or add{" "}
            <code className="font-mono text-primary">STEAM_API_KEY</code> to{" "}
            <code className="font-mono text-primary">.env.local</code>.
          </AlertDescription>
        </Alert>
      ) : (
        <p className="text-xs text-muted-foreground">
          {playtime.games.length} titles · {playtime.source}
        </p>
      )}
    </div>
  );
}
