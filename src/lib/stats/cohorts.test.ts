import assert from "node:assert/strict";
import { test } from "node:test";
import { cohorts } from "./cohorts";
import { makeInput, paidGame, purchase } from "./test-helpers";

test("cohorts: null when no paid title can be dated", () => {
  assert.equal(cohorts(makeInput()), null);
  assert.equal(
    cohorts(makeInput({ paidGames: [paidGame("Undated", 100, 3)] })),
    null,
  );
});

test("cohorts: per purchase year, with refunded and unknown titles undated", () => {
  const stat = cohorts(
    makeInput({
      purchases: [
        purchase("10 Jun, 2023", ["A", "B"], 700),
        purchase("5 May, 2026", ["C"], 300),
        purchase("1 May, 2026", ["R"], 100, { refunded: true }),
      ],
      paidGames: [
        paidGame("A", 400, 50),
        paidGame("B", 300, 0),
        paidGame("C", 300, 0.4),
        paidGame("R", 100, 3),
        paidGame("X", 250, 5),
      ],
    }),
  );
  assert.ok(stat);
  assert.deepEqual(stat.rows, [
    {
      year: "2023",
      titles: 2,
      paid: 700,
      played: 1,
      playedShare: 0.5,
      hours: 50,
      unplayedPaid: 300,
    },
    {
      year: "2026",
      titles: 1,
      paid: 300,
      played: 0,
      playedShare: 0,
      hours: 0,
      unplayedPaid: 300,
    },
  ]);
  assert.equal(stat.undatedTitles, 2); // R (refunded row) and X
  assert.equal(stat.undatedPaid, 350);
});

test("cohorts: the earliest purchase dates a title bought twice", () => {
  const stat = cohorts(
    makeInput({
      purchases: [
        purchase("5 May, 2026", ["A"], 100),
        purchase("10 Jun, 2023", ["a"], 100),
      ],
      paidGames: [paidGame("A", 200, 2)],
    }),
  );
  assert.ok(stat);
  assert.deepEqual(
    stat.rows.map((r) => r.year),
    ["2023"],
  );
  assert.equal(stat.rows[0].playedShare, 1);
});
