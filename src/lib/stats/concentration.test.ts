import assert from "node:assert/strict";
import { test } from "node:test";
import { concentration } from "./concentration";
import { game, makeInput } from "./test-helpers";

test("concentration: null without playtime", () => {
  assert.equal(concentration(makeInput()), null);
  assert.equal(
    concentration(makeInput({ playedGames: [game("A", 0), game("B", 0)] })),
    null,
  );
});

test("concentration: a single game is the whole library", () => {
  const stat = concentration(makeInput({ playedGames: [game("Solo", 10)] }));
  assert.ok(stat);
  assert.equal(stat.totalHours, 10);
  assert.equal(stat.playedCount, 1);
  assert.equal(stat.top.length, 1);
  assert.equal(stat.top[0].share, 1);
  assert.equal(stat.top[0].cumShare, 1);
  assert.equal(stat.gamesForHalf, 1);
  assert.equal(stat.gamesFor80, 1);
  assert.equal(stat.otherCount, 0);
  assert.equal(stat.otherHours, 0);
});

test("concentration: shares, running share and thresholds", () => {
  // 50 + 30 + 15 + 5 = 100 h; the unplayed game is ignored.
  const stat = concentration(
    makeInput({
      playedGames: [
        game("C", 15),
        game("Zero", 0),
        game("A", 50),
        game("D", 5),
        game("B", 30, { fromFamily: true }),
      ],
    }),
  );
  assert.ok(stat);
  assert.equal(stat.totalHours, 100);
  assert.equal(stat.playedCount, 4);
  assert.deepEqual(
    stat.top.map((r) => r.name),
    ["A", "B", "C", "D"],
  );
  assert.deepEqual(
    stat.top.map((r) => r.share),
    [0.5, 0.3, 0.15, 0.05],
  );
  assert.deepEqual(
    stat.top.map((r) => r.cumShare),
    [0.5, 0.8, 0.95, 1],
  );
  assert.equal(stat.top[1].fromFamily, true);
  assert.equal(stat.top[0].fromFamily, false);
  assert.equal(stat.gamesForHalf, 1); // A alone is exactly half
  assert.equal(stat.gamesFor80, 2); // A + B = 80%
});

test("concentration: games past the top ten roll into 'other'", () => {
  const twelve = Array.from({ length: 12 }, (_, i) => game(`G${i}`, 1));
  const stat = concentration(makeInput({ playedGames: twelve }));
  assert.ok(stat);
  assert.equal(stat.top.length, 10);
  assert.equal(stat.otherCount, 2);
  assert.equal(stat.otherHours, 2);
  assert.equal(stat.gamesForHalf, 6); // 6 of 12 equal games
  assert.equal(stat.gamesFor80, 10); // 9/12 = 75%, 10/12 = 83%
});
