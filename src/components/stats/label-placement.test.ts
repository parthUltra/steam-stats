import assert from "node:assert/strict";
import { test } from "node:test";
import {
  intersects,
  markerBox,
  placeLabels,
  type LabelInput,
  type Rect,
} from "./label-placement";

const BOUNDS: Rect = { x: 50, y: 10, width: 500, height: 300 };

const label = (id: string, x: number, y: number, width = 80): LabelInput => ({
  id,
  x,
  y,
  width,
  height: 14,
});

function inside(outer: Rect, r: Rect): boolean {
  return (
    r.x >= outer.x &&
    r.y >= outer.y &&
    r.x + r.width <= outer.x + outer.width &&
    r.y + r.height <= outer.y + outer.height
  );
}

/** Every invariant the chart relies on, for any placement result. */
function assertClean(
  labels: LabelInput[],
  obstacles: Rect[],
  result: ReturnType<typeof placeLabels>,
) {
  assert.equal(result.placed.length + result.dropped.length, labels.length);
  for (const p of result.placed) {
    assert.ok(inside(BOUNDS, p.rect), `${p.id} leaves the plot`);
    for (const o of obstacles) {
      assert.ok(!intersects(p.rect, o), `${p.id} covers a marker`);
    }
  }
  for (let i = 0; i < result.placed.length; i += 1) {
    for (let j = i + 1; j < result.placed.length; j += 1) {
      assert.ok(
        !intersects(result.placed[i].rect, result.placed[j].rect),
        `${result.placed[i].id} overlaps ${result.placed[j].id}`,
      );
    }
  }
}

test("placeLabels: a lone label goes above its marker", () => {
  const labels = [label("a", 300, 150)];
  const result = placeLabels({ labels, bounds: BOUNDS });
  assert.deepEqual(result.dropped, []);
  assert.equal(result.placed[0].anchor, "top");
});

test("placeLabels: two markers side by side get separate label boxes", () => {
  // 30px apart with 100px labels: both cannot sit centred above.
  const labels = [label("first", 300, 150, 100), label("second", 330, 150, 100)];
  const obstacles = labels.map((l) => markerBox(l.x, l.y, 6));
  const result = placeLabels({ labels, bounds: BOUNDS, obstacles });
  assert.deepEqual(result.dropped, []);
  assert.equal(result.placed[0].anchor, "top");
  assert.notEqual(result.placed[1].anchor, "top");
  assertClean(labels, obstacles, result);
});

test("placeLabels: labels at each edge stay inside the plot", () => {
  const labels = [
    label("left", 52, 150),
    label("right", 548, 150),
    label("top", 300, 12),
    label("bottom", 300, 308),
    label("corner", 52, 12),
  ];
  const obstacles = labels.map((l) => markerBox(l.x, l.y, 6));
  const result = placeLabels({ labels, bounds: BOUNDS, obstacles });
  assert.deepEqual(result.dropped, []);
  assertClean(labels, obstacles, result);
  const anchorOf = (id: string) => result.placed.find((p) => p.id === id)?.anchor;
  // Centred-above would cross the left edge, so it moves to the right side.
  assert.equal(anchorOf("left"), "right");
  assert.equal(anchorOf("right"), "left");
  assert.equal(anchorOf("top"), "bottom");
  assert.equal(anchorOf("bottom"), "top");
});

test("placeLabels: a label never covers another point's marker", () => {
  const labels = [label("a", 300, 150, 120)];
  // A neighbour sits exactly where the centred-above label would go.
  const obstacles = [markerBox(300, 150, 6), markerBox(320, 132, 6)];
  const result = placeLabels({ labels, bounds: BOUNDS, obstacles });
  assert.equal(result.placed.length, 1);
  assert.notEqual(result.placed[0].anchor, "top");
  assertClean(labels, obstacles, result);
});

test("placeLabels: when nothing fits, the lower-priority label is dropped", () => {
  // Room for one label above the markers and none below or beside them.
  const tight: Rect = { x: 0, y: 0, width: 90, height: 46 };
  const labels = [label("keep", 45, 25), label("drop", 45, 27)];
  const result = placeLabels({ labels, bounds: tight });
  assert.deepEqual(
    result.placed.map((p) => p.id),
    ["keep"],
  );
  assert.deepEqual(result.dropped, ["drop"]);
});

test("placeLabels: many crowded labels never overlap and keep priority order", () => {
  const labels: LabelInput[] = [];
  for (let i = 0; i < 40; i += 1) {
    // A tight cluster plus a diagonal run: far more labels than free space.
    labels.push(label(`p${i}`, 200 + ((i * 37) % 120), 120 + ((i * 53) % 90), 70 + (i % 5) * 12));
  }
  const obstacles = labels.map((l) => markerBox(l.x, l.y, 6));
  const result = placeLabels({ labels, bounds: BOUNDS, obstacles });
  assertClean(labels, obstacles, result);
  assert.ok(result.placed.length > 0);
  assert.ok(result.dropped.length > 0, "a crowd this dense must drop some");
  assert.equal(result.placed[0].id, "p0", "the top-priority label is always kept");
  // Deterministic: same input, same output.
  assert.deepEqual(placeLabels({ labels, bounds: BOUNDS, obstacles }), result);
});

test("placeLabels: no labels, nothing placed", () => {
  assert.deepEqual(placeLabels({ labels: [], bounds: BOUNDS }), {
    placed: [],
    dropped: [],
  });
});
