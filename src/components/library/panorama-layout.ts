import { ART_SIZE, type ArtKind } from "@/components/SteamArt";
import type { Game } from "@/components/library/model";

/** Panorama only includes titles with at least 30 minutes on record. */
export const MIN_PANO_HOURS = 0.5;

/**
 * Height bands by lifetime hours. `rel` is the row height relative to the top
 * band; `kind` is the Steam asset shown at its native aspect ratio, so no tile
 * is ever cropped. Small bands use the small capsule file, large bands the
 * header.
 */
export const PANO_BANDS: {
  minHours: number;
  rel: number;
  kind: Extract<ArtKind, "header" | "capsule">;
  label: string;
}[] = [
  { minHours: 100, rel: 1, kind: "header", label: "100 h+" },
  { minHours: 25, rel: 0.68, kind: "header", label: "25 h+" },
  { minHours: 5, rel: 0.46, kind: "capsule", label: "5 h+" },
  { minHours: MIN_PANO_HOURS, rel: 0.32, kind: "capsule", label: "30 min+" },
];

/** Wall width ÷ height the layout aims for. */
export const PANO_ASPECT = 2.3;

export type PanoTile = {
  appId: number;
  name: string;
  hours: number;
  band: number;
  kind: Extract<ArtKind, "header" | "capsule">;
  /** width ÷ height of the art (and so of the tile). */
  aspect: number;
};

export type PanoRow = {
  tiles: PanoTile[];
  /** Sum of tile aspects: row height = wall width ÷ aspectSum (before gaps). */
  aspectSum: number;
};

export type PanoLayout = {
  rows: PanoRow[];
  count: number;
  totalHours: number;
  /** Wall height as a fraction of wall width, gaps excluded. */
  heightRatio: number;
};

function bandFor(hours: number): number {
  const i = PANO_BANDS.findIndex((b) => hours >= b.minHours);
  return i === -1 ? PANO_BANDS.length - 1 : i;
}

function toTiles(games: Game[]): PanoTile[] {
  return games
    .filter((g) => g.hoursForever >= MIN_PANO_HOURS)
    .sort((a, b) => b.hoursForever - a.hoursForever)
    .map((g) => {
      const band = bandFor(g.hoursForever);
      const kind = PANO_BANDS[band]!.kind;
      return {
        appId: g.appId,
        name: g.name,
        hours: g.hoursForever,
        band,
        kind,
        aspect: ART_SIZE[kind].width / ART_SIZE[kind].height,
      };
    });
}

/**
 * Justified rows for one scale. `scale` is the top band's target row height as
 * a fraction of the wall width. A row takes tiles until it is as close to full
 * width as it can get, then stretches to exactly full width, so the wall is a
 * clean rectangle and each row's real height is 1 ÷ (sum of aspects).
 */
function rowsForScale(tiles: PanoTile[], scale: number): PanoRow[] {
  const rows: PanoRow[] = [];
  let i = 0;
  while (i < tiles.length) {
    const target = scale * PANO_BANDS[tiles[i]!.band]!.rel;
    const row: PanoTile[] = [];
    let sum = 0;
    while (i < tiles.length) {
      const a = tiles[i]!.aspect;
      const widthWith = (sum + a) * target;
      if (row.length > 0 && widthWith > 1) {
        const overshoot = widthWith - 1;
        const undershoot = 1 - sum * target;
        if (overshoot < undershoot) {
          row.push(tiles[i]!);
          sum += a;
          i += 1;
        }
        break;
      }
      row.push(tiles[i]!);
      sum += a;
      i += 1;
    }
    rows.push({ tiles: row, aspectSum: sum });
  }

  // A short last row would stretch into the tallest row on the wall. Fold it
  // into the row above instead.
  if (rows.length > 1) {
    const last = rows[rows.length - 1]!;
    const prev = rows[rows.length - 2]!;
    if (1 / last.aspectSum > (1 / prev.aspectSum) * 1.25) {
      prev.tiles.push(...last.tiles);
      prev.aspectSum += last.aspectSum;
      rows.pop();
    }
  }
  return rows;
}

const heightOf = (rows: PanoRow[]) =>
  rows.reduce((sum, r) => sum + 1 / r.aspectSum, 0);

/** Rows must not get taller further down the wall (more hours = taller). */
function monotonicPenalty(rows: PanoRow[]): number {
  let penalty = 0;
  for (let i = 1; i < rows.length; i++) {
    const above = 1 / rows[i - 1]!.aspectSum;
    const here = 1 / rows[i]!.aspectSum;
    if (here > above) penalty += (here - above) / above;
  }
  return penalty;
}

/**
 * Lay the library out as a wall of `aspect` (width ÷ height). Tries a range of
 * scales and keeps the one whose wall is closest to the wanted shape while
 * keeping row heights descending. Pure, so screen and PNG export share it.
 */
export function layoutPanorama(games: Game[], aspect = PANO_ASPECT): PanoLayout {
  const tiles = toTiles(games);
  const totalHours = tiles.reduce((s, t) => s + t.hours, 0);
  if (tiles.length === 0) {
    return { rows: [], count: 0, totalHours: 0, heightRatio: 0 };
  }

  const wanted = 1 / aspect;
  let best: PanoRow[] | null = null;
  let bestScore = Infinity;
  for (let scale = 0.03; scale <= 0.6; scale *= 1.02) {
    const rows = rowsForScale(tiles, scale);
    const h = heightOf(rows);
    const score = Math.abs(h - wanted) / wanted + monotonicPenalty(rows) * 2;
    if (score < bestScore) {
      best = rows;
      bestScore = score;
    }
  }
  const rows = best ?? rowsForScale(tiles, 0.1);
  return { rows, count: tiles.length, totalHours, heightRatio: heightOf(rows) };
}
