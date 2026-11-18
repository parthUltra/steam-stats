"use client";

import { format } from "date-fns";
import { memo, useCallback, useMemo, useRef, useState } from "react";
import { DownloadIcon } from "lucide-react";
import {
  SteamArt,
  artDensityPair,
  expandedArtCandidates,
} from "@/components/SteamArt";
import { formatDay, formatHours } from "@/components/library/format";
import type { Game } from "@/components/library/model";
import {
  PANO_BANDS,
  layoutPanorama,
  type PanoLayout,
  type PanoTile,
} from "@/components/library/panorama-layout";
import type { ArtworkUrls } from "@/lib/steam/artwork-resolve";
import { Button } from "@/components/ui/button";

/** Wall width (CSS px) the phone layout scrolls sideways at; see panorama.css. */
const PHONE_WALL_PX = 1180;

type Flat = {
  tile: PanoTile;
  row: number;
  /** Horizontal centre within the row, 0–1. */
  center: number;
  /** Width as a fraction of the wall. */
  width: number;
};

function flatten(layout: PanoLayout): Flat[] {
  const out: Flat[] = [];
  layout.rows.forEach((row, r) => {
    let x = 0;
    for (const tile of row.tiles) {
      const width = tile.aspect / row.aspectSum;
      out.push({ tile, row: r, center: x + width / 2, width });
      x += width;
    }
  });
  return out;
}

/* ——— PNG export: same rows, drawn at print size ——— */

/** Inline art (data: or blob:) is already same-origin and has nothing to proxy. */
function isInlineArt(url: string) {
  return /^(data|blob):/i.test(url);
}

/**
 * Remote art goes through the local proxy so the canvas stays untainted;
 * inline art is used as it is (the proxy only fetches Steam hosts).
 */
function proxiedArtUrl(url: string) {
  return isInlineArt(url) ? url : `/api/steam-art?url=${encodeURIComponent(url)}`;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * Same candidate list as the on-screen tile, so the export never shows a
 * different picture; the 2× file of the resolved asset is tried first.
 */
async function loadTileImage(
  tile: PanoTile,
  artwork?: Record<string, ArtworkUrls>,
): Promise<HTMLImageElement | null> {
  const candidates = expandedArtCandidates(tile.appId, tile.kind, artwork);
  const first = candidates[0];
  const ordered = first
    ? [first, artDensityPair(first).lo, ...candidates.slice(1)]
    : candidates;
  const seen = new Set<string>();
  for (const url of ordered) {
    if (seen.has(url)) continue;
    seen.add(url);
    const img = await loadImage(proxiedArtUrl(url));
    if (img) return img;
  }
  return null;
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!, i);
      }
    }),
  );
  return out;
}

const EXPORT_WIDTH = 3840;

async function downloadPanorama(
  layout: PanoLayout,
  artwork: Record<string, ArtworkUrls> | undefined,
  onProgress: (done: number, total: number) => void,
) {
  const flat = flatten(layout);
  const GAP = 4;
  const rowHeights = layout.rows.map((row) => {
    const inner = EXPORT_WIDTH - GAP * (row.tiles.length - 1);
    return inner / row.aspectSum;
  });
  const height = Math.round(
    rowHeights.reduce((s, h) => s + h, 0) + GAP * (layout.rows.length - 1),
  );

  const canvas = document.createElement("canvas");
  canvas.width = EXPORT_WIDTH;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available in this browser.");

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#06080c";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // One probe before 85 image loads: when the art proxy cannot reach Steam
  // (offline mode), say so at once instead of failing tile by tile.
  const probeUrl = flat[0]
    ? expandedArtCandidates(flat[0].tile.appId, flat[0].tile.kind, artwork)[0]
    : undefined;
  if (probeUrl && !isInlineArt(probeUrl)) {
    const probe = await fetch(proxiedArtUrl(probeUrl)).catch(() => null);
    if (!probe || probe.status === 502) {
      throw new Error(
        "The art proxy cannot reach Steam right now (offline mode or no network).",
      );
    }
  }

  let done = 0;
  const images = await mapLimit(flat, 6, async ({ tile }) => {
    const img = await loadTileImage(tile, artwork);
    done += 1;
    onProgress(done, flat.length);
    return img;
  });
  if (images.every((img) => img == null)) {
    throw new Error(
      "No artwork could be fetched. The art proxy is offline or Steam is unreachable.",
    );
  }

  let i = 0;
  let y = 0;
  layout.rows.forEach((row, r) => {
    const h = rowHeights[r]!;
    let x = 0;
    for (const tile of row.tiles) {
      const w = h * tile.aspect;
      const img = images[i];
      ctx.fillStyle = "#1a2532";
      ctx.fillRect(x, y, w, h);
      if (img) {
        // Cover-fit; a no-op crop when the art has the tile's native aspect.
        const ir = img.naturalWidth / img.naturalHeight;
        const tr = w / h;
        let sw = img.naturalWidth;
        let sh = img.naturalHeight;
        if (ir > tr) sw = sh * tr;
        else sh = sw / tr;
        const sx = (img.naturalWidth - sw) / 2;
        const sy = (img.naturalHeight - sh) / 2;
        ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
      }
      x += w + GAP;
      i += 1;
    }
    y += h + GAP;
  });

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) throw new Error("The browser could not encode the image.");

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  // Local calendar day: toISOString() is UTC and can name yesterday.
  a.download = `steam-panorama-${format(new Date(), "yyyy-MM-dd")}.png`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ——— Screen ——— */

const Tile = memo(function Tile({
  flat,
  index,
  tabbable,
  artwork,
  onOpen,
  onActive,
}: {
  flat: Flat;
  index: number;
  tabbable: boolean;
  artwork?: Record<string, ArtworkUrls>;
  onOpen: (appId: number) => void;
  onActive: (index: number | null, viaFocus: boolean) => void;
}) {
  const { tile, width } = flat;
  const vw = Math.max(4, Math.round(width * 100));
  const phonePx = Math.round(width * PHONE_WALL_PX);
  return (
    <button
      type="button"
      className="pano-tile"
      data-band={tile.band}
      data-index={index}
      tabIndex={tabbable ? 0 : -1}
      style={{ flexGrow: tile.aspect, aspectRatio: String(tile.aspect) }}
      aria-label={`${tile.name}, ${formatHours(tile.hours)} hours`}
      onClick={() => onOpen(tile.appId)}
      onFocus={() => onActive(index, true)}
      onPointerEnter={() => onActive(index, false)}
    >
      <SteamArt
        appId={tile.appId}
        name={tile.name}
        artwork={artwork}
        variant={tile.kind}
        framed={false}
        className="pano-tile-img"
        alt=""
        sizes={`(max-width: 900px) ${phonePx}px, ${vw}vw`}
        priority={tile.band === 0}
      />
      {tile.band <= 1 ? (
        <span className="pano-tile-hours mono" aria-hidden>
          {formatHours(tile.hours)} h
        </span>
      ) : null}
    </button>
  );
});

export function PlaytimePanorama({
  games,
  artwork,
  onOpenGame,
}: {
  games: Game[];
  artwork?: Record<string, ArtworkUrls>;
  onOpenGame: (appId: number) => void;
}) {
  const layout = useMemo(() => layoutPanorama(games), [games]);
  const flat = useMemo(() => flatten(layout), [layout]);
  const rowStarts = useMemo(() => {
    const starts: number[] = [];
    let n = 0;
    for (const row of layout.rows) {
      starts.push(n);
      n += row.tiles.length;
    }
    return starts;
  }, [layout]);
  const gameById = useMemo(
    () => new Map(games.map((g) => [g.appId, g])),
    [games],
  );

  const wallRef = useRef<HTMLDivElement | null>(null);
  /** Roving tabindex: the wall is one tab stop; arrows move inside it. */
  const [cursor, setCursor] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  const [exportState, setExportState] = useState<
    | { phase: "idle" }
    | { phase: "running"; done: number; total: number }
    | { phase: "error"; message: string }
  >({ phase: "idle" });

  const onActive = useCallback((index: number | null, viaFocus: boolean) => {
    setActive(index);
    if (viaFocus && index != null) setCursor(index);
  }, []);

  const focusTile = useCallback((index: number) => {
    setCursor(index);
    wallRef.current
      ?.querySelector<HTMLElement>(`[data-index="${index}"]`)
      ?.focus();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const here = flat[cursor];
    if (!here) return;
    let next: number | null = null;
    if (e.key === "ArrowRight") next = Math.min(flat.length - 1, cursor + 1);
    else if (e.key === "ArrowLeft") next = Math.max(0, cursor - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = flat.length - 1;
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const targetRow = here.row + (e.key === "ArrowDown" ? 1 : -1);
      let bestDist = Infinity;
      flat.forEach((f, i) => {
        if (f.row !== targetRow) return;
        const dist = Math.abs(f.center - here.center);
        if (dist < bestDist) {
          bestDist = dist;
          next = i;
        }
      });
    }
    if (next == null) return;
    e.preventDefault();
    focusTile(next);
  };

  if (layout.count < 4) {
    return (
      <div className="state-block">
        <h3>Not enough playtime for a panorama yet</h3>
        <p>
          The panorama needs at least four titles with 30 minutes or more on
          record. This library has {layout.count}.
        </p>
      </div>
    );
  }

  async function onDownload() {
    if (exportState.phase === "running") return;
    setExportState({ phase: "running", done: 0, total: layout.count });
    try {
      await downloadPanorama(layout, artwork, (done, total) =>
        setExportState({ phase: "running", done, total }),
      );
      setExportState({ phase: "idle" });
    } catch (err) {
      setExportState({
        phase: "error",
        message:
          err instanceof Error ? err.message : "Couldn’t export the panorama.",
      });
    }
  }

  const shown = active != null ? flat[active] : null;
  const shownGame = shown ? gameById.get(shown.tile.appId) : null;
  const shownLast = shownGame ? formatDay(shownGame.lastPlayedAt) : null;

  return (
    <section className="pano" aria-labelledby="pano-title">
      <div className="pano-head">
        <div className="pano-head-text">
          <h3 id="pano-title">Playtime panorama</h3>
          <p>
            <span className="mono">{layout.count}</span> titles with 30 minutes
            or more · <span className="mono">{formatHours(layout.totalHours)}</span>{" "}
            h. Taller rows mean more hours.
          </p>
        </div>
        <div className="pano-actions">
          <ul className="pano-legend" aria-label="Row height bands by hours">
            {PANO_BANDS.map((b, i) => (
              <li key={b.label}>
                <span className="pano-legend-bar" data-band={i} aria-hidden />
                <span className="mono">{b.label}</span>
              </li>
            ))}
          </ul>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onDownload}
            disabled={exportState.phase === "running"}
          >
            <DownloadIcon data-icon="inline-start" />
            {exportState.phase === "running" ? (
              <span>
                Rendering <span className="mono">{exportState.done}</span>/
                <span className="mono">{exportState.total}</span>
              </span>
            ) : (
              "Download PNG"
            )}
          </Button>
        </div>
      </div>

      {exportState.phase === "error" ? (
        <p className="pano-error" role="alert">
          Couldn’t export the panorama. {exportState.message}
        </p>
      ) : null}

      <div className="pano-scroll">
        <div
          ref={wallRef}
          className="pano-wall"
          role="group"
          aria-label={`Playtime panorama, ${layout.count} titles, most played first. Arrow keys move between titles; Enter opens details.`}
          style={{ ["--pano-ratio" as string]: 1 / layout.heightRatio }}
          onKeyDown={onKeyDown}
          onPointerLeave={() => setActive(null)}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
              setActive(null);
            }
          }}
        >
          {layout.rows.map((row, r) => (
            <div className="pano-row" key={row.tiles[0]!.appId}>
              {row.tiles.map((tile, c) => {
                const index = rowStarts[r]! + c;
                return (
                  <Tile
                    key={tile.appId}
                    flat={flat[index]!}
                    index={index}
                    tabbable={index === cursor}
                    artwork={artwork}
                    onOpen={onOpenGame}
                    onActive={onActive}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <p className="pano-readout" aria-hidden>
        {shown ? (
          <>
            <span className="pano-readout-name">{shown.tile.name}</span>
            <span>
              <span className="mono">{formatHours(shown.tile.hours)}</span> h
            </span>
            {shownLast ? <span>Last played {shownLast}</span> : null}
          </>
        ) : (
          <span className="pano-readout-hint">
            Select a tile for details. Arrow keys move between tiles.
          </span>
        )}
      </p>
    </section>
  );
}
