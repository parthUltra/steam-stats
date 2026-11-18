import assert from "node:assert/strict";
import { test } from "node:test";
import { distribution } from "./distribution";
import { game, makeInput } from "./test-helpers";

const counts = (stat: NonNullable<ReturnType<typeof distribution>>) =>
  Object.fromEntries(stat.bins.map((b) => [b.id, b.count]));

test("distribution: null for an empty library", () => {
  assert.equal(distribution(makeInput()), null);
});

test("distribution: a single unplayed game sits in the zero bin", () => {
  const stat = distribution(makeInput({ playedGames: [game("Zero", 0)] }));
  assert.ok(stat);
  assert.equal(stat.gameCount, 1);
  assert.equal(stat.totalHours, 0);
  assert.equal(stat.medianPlayedHours, null);
  assert.equal(stat.bins[0].count, 1);
  assert.equal(stat.bins[0].hoursShare, 0);
  assert.equal(stat.bins.slice(1).every((b) => b.count === 0), true);
});

test("distribution: bin edges are lower-inclusive, upper-exclusive", () => {
  const hours = [0, 0.5, 1, 4.9, 5, 10, 25, 50, 100, 250, 300];
  const stat = distribution(
    makeInput({ playedGames: hours.map((h, i) => game(`G${i}`, h)) }),
  );
  assert.ok(stat);
  assert.deepEqual(counts(stat), {
    "0": 1,
    lt1: 1, // 0.5
    "1-5": 2, // 1 and 4.9
    "5-10": 1, // 5
    "10-25": 1, // 10
    "25-50": 1, // 25
    "50-100": 1, // 50
    "100-250": 1, // 100
    "250+": 2, // 250 and 300
  });
  assert.equal(stat.gameCount, 11);
  // 0.5 + 1 + 4.9 + 5 + 10 + 25 + 50 + 100 + 250 + 300
  assert.ok(Math.abs(stat.totalHours - 746.4) < 1e-9);
  const top = stat.bins.at(-1)!;
  assert.equal(top.hours, 550);
  assert.ok(Math.abs(top.hoursShare - 550 / 746.4) < 1e-9);
  // Ten played games: middle two are 10 and 25.
  assert.equal(stat.medianPlayedHours, 17.5);
});
