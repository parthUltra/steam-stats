"use client";

import { useMemo, useState } from "react";
import type { DashboardPayload } from "@/lib/analytics/dashboard";
import { SteamArt, expandedArtCandidates } from "@/components/SteamArt";
import { formatPlayHours, steamStoreUrl } from "@/lib/steam/artwork";
import type { ArtworkUrls } from "@/lib/steam/artwork-resolve";
import { Button } from "@/components/ui/button";

/** Panorama only includes titles with at least 30 minutes on record. */
const MIN_PANO_HOURS = 0.5;

/** Wide one-screen mosaic (~2.4∶1). */
const COLS = 24;
const ROWS = 10;

type Orientation = "portrait" | "landscape";

type Tile = {
  appId: number;
  name: string;
  hours: number;
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
  orientation: Orientation;
};

type Weighted = {
  appId: number;
  name: string;
  hours: number;
  weight: number;
};

/** Playtime → layout weight. Stronger curve so top titles read clearly larger. */
function weightFor(hours: number): number {
  return Math.pow(Math.max(hours, MIN_PANO_HOURS), 0.55);
}

/**
 * Recursive bipartition treemap — zero gaps, most-played always top/left.
 */
function layoutTreemap(
  items: Weighted[],
  col: number,
  row: number,
  colSpan: number,
  rowSpan: number,
  out: Tile[],
) {
  if (!items.length || colSpan < 1 || rowSpan < 1) return;

  if (items.length === 1) {
    const g = items[0]!;
    out.push({
      appId: g.appId,
      name: g.name,
      hours: g.hours,
      col: col + 1,
      row: row + 1,
      colSpan,
      rowSpan,
      orientation: colSpan >= rowSpan ? "landscape" : "portrait",
    });
    return;
  }

  const area = colSpan * rowSpan;
  if (area <= items.length) {
    packRowMajor(items, col, row, colSpan, rowSpan, out);
    return;
  }

  const total = items.reduce((s, g) => s + g.weight, 0);

  // Split near half weight so blocks stay squarish; heavier prefix → top/left.
  let acc = 0;
  let splitAt = 1;
  for (let i = 0; i < items.length - 1; i++) {
    acc += items[i]!.weight;
    splitAt = i + 1;
    if (acc >= total * 0.5) break;
  }

  let head = items.slice(0, splitAt);
  let tail = items.slice(splitAt);
  const splitVertical = colSpan >= rowSpan;

  if (splitVertical) {
    let headCols = Math.round(
      (head.reduce((s, g) => s + g.weight, 0) / total) * colSpan,
    );
    headCols = Math.max(
      Math.ceil(head.length / rowSpan),
      Math.min(headCols, colSpan - Math.ceil(tail.length / rowSpan)),
    );
    headCols = Math.max(1, Math.min(headCols, colSpan - 1));

    // If constraint forces an impossible split, rebalance item counts
    while (
      head.length > rowSpan * headCols &&
      tail.length > 0
    ) {
      // shouldn't happen with ceil math; rebalance by moving last head → tail
      const moved = head.pop();
      if (moved) tail = [moved, ...tail];
      else break;
      headCols = Math.max(
        Math.ceil(head.length / rowSpan),
        Math.min(
          colSpan - Math.ceil(tail.length / rowSpan),
          colSpan - 1,
        ),
      );
    }
    while (tail.length > rowSpan * (colSpan - headCols) && head.length > 0) {
      const moved = tail.shift();
      if (moved) head = [...head, moved];
      else break;
      headCols = Math.min(
        colSpan - 1,
        Math.max(
          Math.ceil(head.length / rowSpan),
          colSpan - Math.ceil(tail.length / rowSpan),
        ),
      );
    }

    if (
      head.length > headCols * rowSpan ||
      tail.length > (colSpan - headCols) * rowSpan
    ) {
      packRowMajor(items, col, row, colSpan, rowSpan, out);
      return;
    }

    layoutTreemap(head, col, row, headCols, rowSpan, out);
    layoutTreemap(tail, col + headCols, row, colSpan - headCols, rowSpan, out);
  } else {
    let headRows = Math.round(
      (head.reduce((s, g) => s + g.weight, 0) / total) * rowSpan,
    );
    headRows = Math.max(
      Math.ceil(head.length / colSpan),
      Math.min(headRows, rowSpan - Math.ceil(tail.length / colSpan)),
    );
    headRows = Math.max(1, Math.min(headRows, rowSpan - 1));

    while (head.length > colSpan * headRows && tail.length > 0) {
      const moved = head.pop();
      if (moved) tail = [moved, ...tail];
      else break;
      headRows = Math.max(
        Math.ceil(head.length / colSpan),
        Math.min(
          rowSpan - Math.ceil(tail.length / colSpan),
          rowSpan - 1,
        ),
      );
    }
    while (tail.length > colSpan * (rowSpan - headRows) && head.length > 0) {
      const moved = tail.shift();
      if (moved) head = [...head, moved];
      else break;
      headRows = Math.min(
        rowSpan - 1,
        Math.max(
          Math.ceil(head.length / colSpan),
          rowSpan - Math.ceil(tail.length / colSpan),
        ),
      );
    }

    if (
      head.length > headRows * colSpan ||
      tail.length > (rowSpan - headRows) * colSpan
    ) {
      packRowMajor(items, col, row, colSpan, rowSpan, out);
      return;
    }

    layoutTreemap(head, col, row, colSpan, headRows, out);
    layoutTreemap(tail, col, row + headRows, colSpan, rowSpan - headRows, out);
  }
}

/** 1×1 reading-order fallback when a region is too tight to split. */
function packRowMajor(
  items: Weighted[],
  col: number,
  row: number,
  colSpan: number,
  rowSpan: number,
  out: Tile[],
) {
  const area = colSpan * rowSpan;
  items.slice(0, area).forEach((g, i) => {
    const rr = Math.floor(i / colSpan);
    const cc = i % colSpan;
    if (rr >= rowSpan) return;
    out.push({
      appId: g.appId,
      name: g.name,
      hours: g.hours,
      col: col + cc + 1,
      row: row + rr + 1,
      colSpan: 1,
      rowSpan: 1,
      orientation: "landscape",
    });
  });
}

function buildTiles(
  games: DashboardPayload["playtime"]["games"],
): Tile[] {
  const played = games
    .filter((g) => g.hoursForever >= MIN_PANO_HOURS)
    .sort((a, b) => b.hoursForever - a.hoursForever);
  if (!played.length) return [];

  // Grow the grid only if we have more titles than cells (keep it one screen).
  let cols = COLS;
  let rows = ROWS;
  while (cols * rows < played.length) {
    cols += 2;
    rows += 1;
  }

  const items: Weighted[] = played.map((g) => ({
    appId: g.appId,
    name: g.name,
    hours: g.hoursForever,
    weight: weightFor(g.hoursForever),
  }));

  const out: Tile[] = [];
  layoutTreemap(items, 0, 0, cols, rows, out);
  return out;
}

function gridSize(tiles: Tile[]): { cols: number; rows: number } {
  return {
    cols: tiles.reduce((m, t) => Math.max(m, t.col + t.colSpan - 1), 0),
    rows: tiles.reduce((m, t) => Math.max(m, t.row + t.rowSpan - 1), 0),
  };
}

function proxiedArtUrl(url: string) {
  return `/api/steam-art?url=${encodeURIComponent(url)}`;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function loadTileImage(
  tile: Tile,
  artwork?: Record<string, ArtworkUrls>,
): Promise<HTMLImageElement | null> {
  const kind = tile.orientation === "portrait" ? "library" : "header";
  const candidates = expandedArtCandidates(tile.appId, kind, artwork);
  for (const url of candidates) {
    const img = await loadImage(proxiedArtUrl(url));
    if (img) return img;
  }
  return null;
}

/** Cover the tile with light center crop — no letterbox gaps. */
function drawCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
  orientation: Orientation,
) {
  const ir = img.naturalWidth / img.naturalHeight;
  const tr = w / h;
  let sx = 0;
  let sy = 0;
  let sw = img.naturalWidth;
  let sh = img.naturalHeight;

  if (ir > tr) {
    sw = img.naturalHeight * tr;
    sx = (img.naturalWidth - sw) / 2;
  } else {
    sh = img.naturalWidth / tr;
    sy =
      orientation === "portrait"
        ? Math.min((img.naturalHeight - sh) * 0.15, img.naturalHeight - sh)
        : (img.naturalHeight - sh) / 2;
  }

  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

async function downloadPanorama(
  tiles: Tile[],
  cols: number,
  rows: number,
  artwork?: Record<string, ArtworkUrls>,
) {
  const GAP = 4;
  const WIDTH = 2400;
  const exportH = Math.round(WIDTH * (rows / cols));
  const cW = (WIDTH - GAP * (cols - 1)) / cols;
  const cH = (exportH - GAP * (rows - 1)) / rows;
  const radius = 6;

  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = Math.max(1, exportH);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unsupported");

  ctx.fillStyle = "#0a0e14";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const images = await Promise.all(
    tiles.map((tile) => loadTileImage(tile, artwork)),
  );

  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i]!;
    const img = images[i];
    const x = (tile.col - 1) * (cW + GAP);
    const y = (tile.row - 1) * (cH + GAP);
    const w = tile.colSpan * cW + (tile.colSpan - 1) * GAP;
    const h = tile.rowSpan * cH + (tile.rowSpan - 1) * GAP;

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
    ctx.clip();
    ctx.fillStyle = "#0c1016";
    ctx.fillRect(x, y, w, h);
    if (img) drawCover(ctx, img, x, y, w, h, tile.orientation);
    ctx.restore();
  }

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) throw new Error("Export failed");

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `steam-panorama-${new Date().toISOString().slice(0, 10)}.png`;
  a.click();
  URL.revokeObjectURL(url);
}

function PanoTile({
  tile,
  artwork,
  index,
}: {
  tile: Tile;
  artwork?: Record<string, ArtworkUrls>;
  index: number;
}) {
  const variant = tile.orientation === "portrait" ? "portrait" : "header";

  return (
    <a
      className={`pano-tile pano-tile-${tile.orientation}`}
      href={steamStoreUrl(tile.appId)}
      target="_blank"
      rel="noreferrer"
      style={{
        gridColumn: `${tile.col} / span ${tile.colSpan}`,
        gridRow: `${tile.row} / span ${tile.rowSpan}`,
        animationDelay: `${Math.min(index, 20) * 18}ms`,
      }}
      title={`${tile.name} · ${formatPlayHours(tile.hours)}h`}
    >
      <SteamArt
        appId={tile.appId}
        name={tile.name}
        artwork={artwork}
        variant={variant}
        framed={false}
        className="pano-tile-img"
        alt={tile.name}
      />
      <div className="pano-tile-shade" />
      <div className="pano-tile-meta">
        <span className="pano-tile-hours">
          {formatPlayHours(tile.hours)}h
        </span>
        <span className="pano-tile-name">{tile.name}</span>
      </div>
    </a>
  );
}

export function PlaytimePanorama({
  games,
  artwork,
}: {
  games: DashboardPayload["playtime"]["games"];
  artwork?: Record<string, ArtworkUrls>;
}) {
  const [downloading, setDownloading] = useState(false);
  const tiles = useMemo(() => buildTiles(games), [games]);
  const { cols, rows } = useMemo(() => gridSize(tiles), [tiles]);
  const totalHours = useMemo(
    () => tiles.reduce((s, t) => s + t.hours, 0),
    [tiles],
  );

  if (tiles.length < 4) {
    return (
      <p className="muted library-empty">
        Need at least a few titles with 30+ minutes to build a panorama.
      </p>
    );
  }

  async function onDownload() {
    if (downloading) return;
    setDownloading(true);
    try {
      await downloadPanorama(tiles, cols, rows, artwork);
    } catch (err) {
      console.error(err);
      window.alert("Couldn’t export the panorama. Try again in a moment.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <section className="pano pano-tab">
      <div className="pano-head">
        <div>
          <p className="pano-kicker">Playtime panorama</p>
          <h3>Hours as a wall of capsules</h3>
          <p className="pano-lede">
            {tiles.length} titles over 30m · {formatPlayHours(totalHours)}h —
            most played at top-left, lesser toward the edges.
          </p>
        </div>
        <div className="pano-actions">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onDownload}
            disabled={downloading}
          >
            {downloading ? "Downloading…" : "Download"}
          </Button>
        </div>
      </div>
      <div
        className="pano-wall"
        role="list"
        style={{
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
        }}
      >
        {tiles.map((tile, i) => (
          <PanoTile
            key={tile.appId}
            tile={tile}
            artwork={artwork}
            index={i}
          />
        ))}
      </div>
    </section>
  );
}
