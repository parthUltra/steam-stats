"use client";

import { useMemo, useState } from "react";
import type { DashboardPayload } from "@/lib/analytics/dashboard";
import { SteamArt, expandedArtCandidates } from "@/components/SteamArt";
import { formatPlayHours, steamStoreUrl } from "@/lib/steam/artwork";
import type { ArtworkUrls } from "@/lib/steam/artwork-resolve";
import { Button } from "@/components/ui/button";

/** Panorama only includes titles with at least 30 minutes on record. */
const MIN_PANO_HOURS = 0.5;

/** Base mosaic density (~2.4∶1). Grown with library size so 1-cell tiles stay small. */
const BASE_COLS = 48;
const BASE_ROWS = 20;
/** Aim for this many cells per title so playtime can still scale above 1×1. */
const CELLS_PER_TITLE = 5;
const MAX_COLS = 96;
const MAX_ROWS = 40;
/** Longest∶shortest side for any tile (grid cells). Keeps art readable. */
const MAX_ASPECT = 2.5;

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

/** Playtime → layout weight. Curve keeps big titles dominant without flattening the long tail. */
function weightFor(hours: number): number {
  return Math.pow(Math.max(hours, MIN_PANO_HOURS), 0.62);
}

function gridForCount(n: number): { cols: number; rows: number } {
  const target = Math.max(BASE_COLS * BASE_ROWS, n * CELLS_PER_TITLE);
  let cols = Math.max(BASE_COLS, Math.ceil(Math.sqrt(target * 2.4)));
  let rows = Math.max(BASE_ROWS, Math.ceil(target / cols));
  cols = Math.min(cols, MAX_COLS);
  rows = Math.min(rows, MAX_ROWS);
  while (cols * rows < n) {
    if (cols < MAX_COLS) cols += 2;
    else rows += 1;
  }
  return { cols, rows };
}

/** Longest∶shortest side ratio for a w×h rect. */
function regionAspect(colSpan: number, rowSpan: number) {
  const a = Math.max(colSpan, 1);
  const b = Math.max(rowSpan, 1);
  return Math.max(a / b, b / a);
}

function pushTile(
  out: Tile[],
  g: Weighted,
  col: number,
  row: number,
  colSpan: number,
  rowSpan: number,
) {
  const w = Math.max(1, colSpan);
  const h = Math.max(1, rowSpan);
  out.push({
    appId: g.appId,
    name: g.name,
    hours: g.hours,
    col: col + 1,
    row: row + 1,
    colSpan: w,
    rowSpan: h,
    orientation: w >= h ? "landscape" : "portrait",
  });
}

/** Integer sizes proportional to weights; exact sum. */
function splitByWeight(weights: number[], total: number): number[] {
  if (weights.length === 0) return [];
  if (weights.length === 1) return [Math.max(1, total)];
  const sumW = weights.reduce((a, b) => a + b, 0) || 1;
  const raw = weights.map((w) => (w / sumW) * total);
  const sizes = raw.map((v) => Math.max(1, Math.floor(v)));
  let used = sizes.reduce((a, b) => a + b, 0);
  // Fix sum — give leftovers to largest fractional remainders
  const order = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  let oi = 0;
  while (used < total && oi < order.length * total) {
    sizes[order[oi % order.length]!.i]! += 1;
    used += 1;
    oi += 1;
  }
  while (used > total) {
    for (let i = sizes.length - 1; i >= 0 && used > total; i--) {
      if (sizes[i]! > 1) {
        sizes[i]! -= 1;
        used -= 1;
      }
    }
    if (sizes.every((s) => s <= 1) && used > total) break;
  }
  return sizes;
}

/**
 * Worst aspect ratio if `row` is laid out as a strip of fixed side `length`
 * inside a remaining area whose total value is `area` (weight units scale).
 */
function worstAspect(
  row: Weighted[],
  length: number,
  rowWeight: number,
  totalWeight: number,
  area: number,
): number {
  if (!row.length || length < 1 || rowWeight <= 0 || totalWeight <= 0) {
    return Infinity;
  }
  const rowArea = (rowWeight / totalWeight) * area;
  const depth = rowArea / length;
  if (depth <= 0) return Infinity;
  let worst = 1;
  for (const g of row) {
    const side = (g.weight / rowWeight) * length;
    const ar = Math.max(side / depth, depth / Math.max(side, 1e-9));
    if (ar > worst) worst = ar;
  }
  return worst;
}

/**
 * Squarified treemap — every cell covered, no holes. Prefers aspects near 1;
 * stays within MAX_ASPECT when the remaining rect allows.
 */
function layoutSquarified(
  items: Weighted[],
  col: number,
  row: number,
  colSpan: number,
  rowSpan: number,
  out: Tile[],
) {
  if (!items.length || colSpan < 1 || rowSpan < 1) return;

  if (items.length === 1) {
    pushTile(out, items[0]!, col, row, colSpan, rowSpan);
    return;
  }

  const area = colSpan * rowSpan;
  if (area <= items.length) {
    // One cell each — covers fully, aspect 1
    const n = Math.min(items.length, area);
    for (let i = 0; i < n; i++) {
      const rr = Math.floor(i / colSpan);
      const cc = i % colSpan;
      if (rr >= rowSpan) break;
      pushTile(out, items[i]!, col + cc, row + rr, 1, 1);
    }
    return;
  }

  const totalWeight = items.reduce((s, g) => s + g.weight, 0);
  const vertical = colSpan < rowSpan; // strip across the shorter side
  const length = vertical ? colSpan : rowSpan;

  let rowItems: Weighted[] = [];
  let rowWeight = 0;
  let idx = 0;

  const accept = (next: Weighted) => {
    const trial = rowItems.concat(next);
    const trialW = rowWeight + next.weight;
    if (!rowItems.length) return true;
    return (
      worstAspect(trial, length, trialW, totalWeight, area) <=
      worstAspect(rowItems, length, rowWeight, totalWeight, area)
    );
  };

  while (idx < items.length) {
    const g = items[idx]!;
    if (accept(g)) {
      rowItems.push(g);
      rowWeight += g.weight;
      idx += 1;
      continue;
    }
    break;
  }

  if (!rowItems.length) {
    rowItems = [items[0]!];
    rowWeight = items[0]!.weight;
    idx = 1;
  }

  const rest = items.slice(idx);
  // Depth of this strip in cells
  let depth = Math.round((rowWeight / totalWeight) * (vertical ? rowSpan : colSpan));
  const minRest = rest.length > 0 ? 1 : 0;
  const maxSide = vertical ? rowSpan : colSpan;
  depth = Math.max(1, Math.min(depth, maxSide - minRest));
  if (rest.length === 0) depth = maxSide;

  if (vertical) {
    // Horizontal strip: full width, `depth` rows — stack items left→right
    const widths = splitByWeight(
      rowItems.map((g) => g.weight),
      colSpan,
    );
    let x = 0;
    for (let i = 0; i < rowItems.length; i++) {
      const w = widths[i]!;
      pushTile(out, rowItems[i]!, col + x, row, w, depth);
      x += w;
    }
    if (rest.length) {
      layoutSquarified(rest, col, row + depth, colSpan, rowSpan - depth, out);
    }
  } else {
    // Vertical strip: full height, `depth` cols — stack items top→bottom
    const heights = splitByWeight(
      rowItems.map((g) => g.weight),
      rowSpan,
    );
    let y = 0;
    for (let i = 0; i < rowItems.length; i++) {
      const h = heights[i]!;
      pushTile(out, rowItems[i]!, col, row + y, depth, h);
      y += h;
    }
    if (rest.length) {
      layoutSquarified(rest, col + depth, row, colSpan - depth, rowSpan, out);
    }
  }
}

/**
 * If any cell is uncovered (rounding edge cases), grow a neighbor tile into it.
 * Prefers expansions that stay ≤ MAX_ASPECT; forces fill if needed so no gaps.
 */
function sealGaps(tiles: Tile[], cols: number, rows: number): Tile[] {
  if (!tiles.length) return tiles;
  const owner: number[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => -1),
  );
  const list = tiles.map((t) => ({ ...t }));

  const paint = (ti: number) => {
    const t = list[ti]!;
    for (let r = t.row - 1; r < t.row - 1 + t.rowSpan; r++) {
      for (let c = t.col - 1; c < t.col - 1 + t.colSpan; c++) {
        if (r >= 0 && r < rows && c >= 0 && c < cols) owner[r]![c] = ti;
      }
    }
  };
  list.forEach((_, i) => paint(i));

  const tryExpand = (ti: number, c0: number, r0: number, force: boolean) => {
    const t = list[ti]!;
    const nc0 = Math.min(t.col - 1, c0);
    const nr0 = Math.min(t.row - 1, r0);
    const nc1 = Math.max(t.col - 1 + t.colSpan - 1, c0);
    const nr1 = Math.max(t.row - 1 + t.rowSpan - 1, r0);
    const nw = nc1 - nc0 + 1;
    const nh = nr1 - nr0 + 1;
    if (!force && regionAspect(nw, nh) > MAX_ASPECT + 0.001) return false;
    // Must not overlap a different owner
    for (let r = nr0; r <= nr1; r++) {
      for (let c = nc0; c <= nc1; c++) {
        const o = owner[r]![c]!;
        if (o !== -1 && o !== ti) return false;
      }
    }
    t.col = nc0 + 1;
    t.row = nr0 + 1;
    t.colSpan = nw;
    t.rowSpan = nh;
    t.orientation = nw >= nh ? "landscape" : "portrait";
    paint(ti);
    return true;
  };

  for (const force of [false, true]) {
    let guard = cols * rows + 2;
    while (guard-- > 0) {
      let empty: { c: number; r: number } | null = null;
      outer: for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (owner[r]![c] === -1) {
            empty = { c, r };
            break outer;
          }
        }
      }
      if (!empty) break;

      const neighbors: number[] = [];
      for (const [dc, dr] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const rr = empty.r + dr;
        const cc = empty.c + dc;
        if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
        const o = owner[rr]![cc]!;
        if (o >= 0 && !neighbors.includes(o)) neighbors.push(o);
      }
      // Prefer larger tiles / better aspect after expand
      neighbors.sort((a, b) => {
        const ta = list[a]!;
        const tb = list[b]!;
        return tb.colSpan * tb.rowSpan - ta.colSpan * ta.rowSpan;
      });

      let filled = false;
      for (const ti of neighbors) {
        if (tryExpand(ti, empty.c, empty.r, force)) {
          filled = true;
          break;
        }
      }
      if (!filled && neighbors.length) {
        tryExpand(neighbors[0]!, empty.c, empty.r, true);
        filled = true;
      }
      if (!filled) {
        // No neighbor (shouldn't happen mid-grid) — skip to avoid infinite loop
        owner[empty.r]![empty.c] = -2;
      }
    }
  }

  return list;
}

function buildTiles(
  games: DashboardPayload["playtime"]["games"],
): Tile[] {
  const played = games
    .filter((g) => g.hoursForever >= MIN_PANO_HOURS)
    .sort((a, b) => b.hoursForever - a.hoursForever);
  if (!played.length) return [];

  const { cols, rows } = gridForCount(played.length);

  const items: Weighted[] = played.map((g) => ({
    appId: g.appId,
    name: g.name,
    hours: g.hoursForever,
    weight: weightFor(g.hoursForever),
  }));

  const out: Tile[] = [];
  layoutSquarified(items, 0, 0, cols, rows, out);
  return sealGaps(out, cols, rows);
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
  opts?: { highRes?: boolean },
): Promise<HTMLImageElement | null> {
  const kind = tile.orientation === "portrait" ? "library" : "header";
  const base = expandedArtCandidates(tile.appId, kind, artwork);
  const hiRes =
    kind === "library"
      ? [
          `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${tile.appId}/library_600x900_2x.jpg`,
          `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${tile.appId}/library_600x900.jpg`,
        ]
      : [
          `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${tile.appId}/header_2x.jpg`,
          `https://cdn.cloudflare.steamstatic.com/steam/apps/${tile.appId}/header_2x.jpg`,
        ];

  const candidates = opts?.highRes
    ? [...hiRes, ...base].filter((u, i, arr) => arr.indexOf(u) === i)
    : base;

  // Prefer already-hashed 2× / large assets when exporting
  const ordered = opts?.highRes
    ? [
        ...candidates.filter((u) => /_2x|600x900/i.test(u)),
        ...candidates,
      ].filter((u, i, arr) => arr.indexOf(u) === i)
    : candidates;

  for (const url of ordered) {
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

function exportCanvasSize(cols: number, rows: number): {
  width: number;
  height: number;
} {
  /** ~128px per grid cell → crisp on 4K/5K and print-ish at large libraries. */
  const MIN_CELL = 128;
  const MAX_EDGE = 8192;
  let width = Math.max(3840, cols * MIN_CELL);
  let height = Math.round(width * (rows / cols));
  if (width > MAX_EDGE) {
    width = MAX_EDGE;
    height = Math.round(width * (rows / cols));
  }
  if (height > MAX_EDGE) {
    height = MAX_EDGE;
    width = Math.round(height * (cols / rows));
  }
  return { width, height: Math.max(1, height) };
}

async function downloadPanorama(
  tiles: Tile[],
  cols: number,
  rows: number,
  artwork?: Record<string, ArtworkUrls>,
) {
  const { width: WIDTH, height: exportH } = exportCanvasSize(cols, rows);
  const GAP = Math.max(2, Math.round(WIDTH / 2400));
  const cW = (WIDTH - GAP * (cols - 1)) / cols;
  const cH = (exportH - GAP * (rows - 1)) / rows;
  const radius = Math.max(2, Math.round(Math.min(cW, cH) * 0.06));

  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = exportH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unsupported");

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#0a0e14";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const images = await Promise.all(
    tiles.map((tile) => loadTileImage(tile, artwork, { highRes: true })),
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
      aria-label={`${tile.name}, ${formatPlayHours(tile.hours)} hours`}
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
          <h3>Playtime panorama</h3>
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
          ["--pano-cols" as string]: cols,
          ["--pano-rows" as string]: rows,
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
