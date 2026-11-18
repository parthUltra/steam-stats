/**
 * Collision-free placement for point labels on a scatter plot. Pure geometry:
 * pixels in, pixels out, no DOM and no measuring.
 *
 * Labels are placed greedily in priority order. Each tries a fixed list of
 * anchors around its marker and takes the first one that stays inside the
 * plot and touches nothing already there; a label with no free anchor is
 * dropped. The same input always gives the same output.
 */

export type Rect = { x: number; y: number; width: number; height: number };

export type LabelInput = {
  id: string;
  /** Marker centre, in the same pixel space as `bounds`. */
  x: number;
  y: number;
  /** Label box size. */
  width: number;
  height: number;
};

export type Anchor =
  | "top"
  | "bottom"
  | "right"
  | "left"
  | "top-right"
  | "top-left"
  | "bottom-right"
  | "bottom-left";

export type PlacedLabel = {
  id: string;
  anchor: Anchor;
  /** The label box. */
  rect: Rect;
};

/** Tried in this order: above first, then below, sides, and the corners. */
export const ANCHORS: readonly Anchor[] = [
  "top",
  "bottom",
  "right",
  "left",
  "top-right",
  "top-left",
  "bottom-right",
  "bottom-left",
];

export function intersects(a: Rect, b: Rect, pad = 0): boolean {
  return (
    a.x < b.x + b.width + pad &&
    a.x + a.width + pad > b.x &&
    a.y < b.y + b.height + pad &&
    a.y + a.height + pad > b.y
  );
}

function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** The label box for one anchor, `gap` pixels clear of the marker centre. */
export function anchorRect(label: LabelInput, anchor: Anchor, gap: number): Rect {
  const { x, y, width, height } = label;
  const above = y - gap - height;
  const below = y + gap;
  const middle = y - height / 2;
  switch (anchor) {
    case "top":
      return { x: x - width / 2, y: above, width, height };
    case "bottom":
      return { x: x - width / 2, y: below, width, height };
    case "right":
      return { x: x + gap, y: middle, width, height };
    case "left":
      return { x: x - gap - width, y: middle, width, height };
    case "top-right":
      return { x: x + gap / 2, y: above, width, height };
    case "top-left":
      return { x: x - gap / 2 - width, y: above, width, height };
    case "bottom-right":
      return { x: x + gap / 2, y: below, width, height };
    case "bottom-left":
      return { x: x - gap / 2 - width, y: below, width, height };
  }
}

export function placeLabels(input: {
  /** Highest priority first: earlier labels win contested space. */
  labels: readonly LabelInput[];
  /** Area labels must stay inside (the plot, never the axes). */
  bounds: Rect;
  /** Boxes no label may touch: every marker, plus fixed text in the plot. */
  obstacles?: readonly Rect[];
  /** Distance from marker centre to label box. */
  gap?: number;
  /** Clear space kept between a label and anything else. */
  padding?: number;
}): { placed: PlacedLabel[]; dropped: string[] } {
  const gap = input.gap ?? 9;
  const padding = input.padding ?? 2;
  const obstacles = input.obstacles ?? [];
  const placed: PlacedLabel[] = [];
  const dropped: string[] = [];

  for (const label of input.labels) {
    let fit: PlacedLabel | null = null;
    for (const anchor of ANCHORS) {
      const rect = anchorRect(label, anchor, gap);
      if (!contains(input.bounds, rect)) continue;
      if (placed.some((p) => intersects(rect, p.rect, padding))) continue;
      if (obstacles.some((o) => intersects(rect, o, padding))) continue;
      fit = { id: label.id, anchor, rect };
      break;
    }
    if (fit) placed.push(fit);
    else dropped.push(label.id);
  }
  return { placed, dropped };
}

/** Square box around a marker, for use as an obstacle. */
export function markerBox(x: number, y: number, radius: number): Rect {
  return { x: x - radius, y: y - radius, width: radius * 2, height: radius * 2 };
}

/**
 * Width of a label at the chart's 12px UI face. An over-estimate on purpose:
 * a label that is a little narrower than its box never collides, one that is
 * wider would.
 */
export function estimateTextWidth(text: string, fontSize = 12): number {
  let units = 0;
  for (const ch of text) {
    if (/[A-Z0-9MWmw@&%™]/.test(ch)) units += 0.7;
    else if (/[ilj.,:;'!| ]/.test(ch)) units += 0.34;
    else units += 0.58;
  }
  return Math.ceil(units * fontSize) + 2;
}
