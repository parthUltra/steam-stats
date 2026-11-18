import assert from "node:assert/strict";
import { test } from "node:test";
import { game, makeInput, paidGame } from "./test-helpers";
import { valueMap } from "./value-map";

test("valueMap: null without paid titles", () => {
  assert.equal(valueMap(makeInput()), null);
  assert.equal(valueMap(makeInput({ paidGames: [paidGame("Free", 0, 9)] })), null);
});

test("valueMap: splits played from unplayed and ranks regrets and steals", () => {
  const stat = valueMap(
    makeInput({
      playedGames: [game("A", 100), game("Elsewhere", 100)],
      paidGames: [
        paidGame("A", 1000, 100),
        paidGame("B", 500, 20),
        paidGame("C", 200, 0.5),
        paidGame("D", 800, 0),
        paidGame("E", 100, 1),
        paidGame("F", 300, 0.2),
      ],
    }),
  );
  assert.ok(stat);
  assert.deepEqual(
    stat.points.map((p) => p.title),
    ["A", "B", "C", "E"],
  );
  // Rates follow the app's rule: under an hour counts as one hour.
  assert.deepEqual(
    stat.points.map((p) => p.rate),
    [10, 25, 200, 100],
  );
  assert.deepEqual(
    stat.unplayed.map((u) => u.title),
    ["D", "F"],
  );
  assert.equal(stat.medianPaid, 400); // 100,200,300 | 500,800,1000
  assert.equal(stat.medianHours, 10.5); // 0.5, 1 | 20, 100
  // Paid ≥ 400 with under 2 h: only D (A and B were played plenty).
  assert.deepEqual(
    stat.regrets.map((r) => r.title),
    ["D"],
  );
  assert.deepEqual(
    stat.steals.map((s) => s.title),
    ["A", "B"],
  );
  assert.ok(Math.abs(stat.hoursCovered - 121.7) < 1e-9);
  assert.equal(stat.totalHours, 200);
});

test("valueMap: a single unplayed purchase is its own regret", () => {
  const stat = valueMap(makeInput({ paidGames: [paidGame("Lonely", 250, 0)] }));
  assert.ok(stat);
  assert.equal(stat.points.length, 0);
  assert.equal(stat.medianHours, null);
  assert.equal(stat.medianPaid, 250);
  assert.deepEqual(
    stat.regrets.map((r) => r.title),
    ["Lonely"],
  );
  assert.deepEqual(stat.steals, []);
  assert.equal(stat.totalHours, 0);
});
