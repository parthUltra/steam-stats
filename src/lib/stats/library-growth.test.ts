import assert from "node:assert/strict";
import { test } from "node:test";
import { libraryGrowth } from "./library-growth";
import { game, makeInput, purchase } from "./test-helpers";

const license = (dateText: string, item: string) => ({
  dateText,
  item,
  acquisitionMethod: "Steam Store",
  packageId: null,
  removableComplimentary: false,
});

test("libraryGrowth: null with no owned games or no dates at all", () => {
  assert.equal(libraryGrowth(makeInput()), null);
  assert.equal(
    libraryGrowth(makeInput({ playedGames: [game("Undated", 4)] })),
    null,
  );
  assert.equal(
    libraryGrowth(
      makeInput({
        playedGames: [game("Fam", 4, { fromFamily: true, addedAt: 1 })],
      }),
    ),
    null,
  );
});

test("libraryGrowth: dates from purchases, licences and addedAt; gap-filled", () => {
  const stat = libraryGrowth(
    makeInput({
      playedGames: [
        // Purchase (May) beats the later addedAt (June).
        game("A", 1, { addedAt: new Date(2026, 5, 20).getTime() }),
        game("B", 0, { addedAt: new Date(2026, 5, 15).getTime() }),
        game("C", 2),
        game("D", 0),
        game("Fam", 9, { fromFamily: true }),
      ],
      purchases: [purchase("10 May, 2026", ["A"], 100)],
      licenses: [license("3 May, 2026", "D")],
    }),
  );
  assert.ok(stat);
  assert.equal(stat.ownedCount, 4);
  assert.equal(stat.datedCount, 3); // C has no date anywhere
  assert.equal(stat.coverage, 0.75);
  assert.equal(stat.chartable, true);
  // Snapshot is July 2026, so the series runs May → July.
  assert.deepEqual(stat.points, [
    { month: "2026-05", added: 2, total: 2 },
    { month: "2026-06", added: 1, total: 3 },
    { month: "2026-07", added: 0, total: 3 },
  ]);
  assert.deepEqual(stat.busiestMonth, { month: "2026-05", added: 2 });
});

test("libraryGrowth: thin coverage is reported but not chartable", () => {
  const stat = libraryGrowth(
    makeInput({
      playedGames: [game("A", 1), game("B", 1), game("C", 1)],
      purchases: [purchase("10 May, 2026", ["A"], 100)],
    }),
  );
  assert.ok(stat);
  assert.equal(stat.datedCount, 1);
  assert.equal(stat.ownedCount, 3);
  assert.equal(stat.chartable, false);
});

test("libraryGrowth: a refunded purchase does not date a game", () => {
  assert.equal(
    libraryGrowth(
      makeInput({
        playedGames: [game("A", 1)],
        purchases: [purchase("10 May, 2026", ["A"], 100, { refunded: true })],
      }),
    ),
    null,
  );
});

test("libraryGrowth: a received gift's date dates a game nothing else does", () => {
  const input = makeInput({
    playedGames: [game("Gifted", 3), game("Bought", 1), game("Also Gifted™", 2)],
    purchases: [purchase("10 May, 2026", ["Bought"], 100)],
  });
  // Without gift dates only "Bought" is dated.
  assert.equal(libraryGrowth(input)?.datedCount, 1);

  const stat = libraryGrowth({
    ...input,
    receivedGifts: [
      { title: "Gifted", receivedAt: new Date(2026, 3, 2).getTime() },
      { title: "Also Gifted", receivedAt: new Date(2026, 4, 20).getTime() },
      { title: "Undated Gift", receivedAt: null },
      { title: "Not In Library", receivedAt: new Date(2026, 0, 1).getTime() },
    ],
  });
  assert.ok(stat);
  assert.equal(stat.datedCount, 3);
  assert.deepEqual(stat.points.slice(0, 2), [
    { month: "2026-04", added: 1, total: 1 },
    { month: "2026-05", added: 2, total: 3 },
  ]);
});
