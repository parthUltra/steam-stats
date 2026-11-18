import assert from "node:assert/strict";
import { test } from "node:test";
import { paidVsLow } from "./paid-vs-low";
import { makeInput, shelfGame } from "./test-helpers";

test("paidVsLow: null when nothing has both a price paid and a low", () => {
  assert.equal(paidVsLow(makeInput()), null);
  assert.equal(
    paidVsLow(
      makeInput({
        valuationGames: [
          shelfGame("No low", { paid: 400, lowest: null }),
          shelfGame("Free", { paid: null, lowest: 100, kind: "free" }),
        ],
      }),
    ),
    null,
  );
});

test("paidVsLow: gaps, totals and exclusions", () => {
  const stat = paidVsLow(
    makeInput({
      valuationGames: [
        shelfGame("B", { paid: 100, lowest: 150 }),
        shelfGame("A", { paid: 500, lowest: 300 }),
        shelfGame("C", { paid: 200, lowest: 200 }),
        shelfGame("D", { paid: 400, lowest: null }),
        shelfGame("Zero low", { paid: 250, lowest: 0 }),
        shelfGame("Bundle", { paid: 300, lowest: 100, kind: "bundle" }),
        shelfGame("Gift", { paid: null, lowest: 100, kind: "gifted_to_me" }),
      ],
    }),
  );
  assert.ok(stat);
  assert.deepEqual(
    stat.rows.map((r) => [r.title, r.gap]),
    [
      ["A", 200],
      ["C", 0],
      ["B", -50],
    ],
  );
  assert.equal(stat.aboveCount, 1);
  assert.equal(stat.atOrBelowCount, 2); // matching the low counts as "at"
  assert.equal(stat.aboveTotal, 200);
  assert.equal(stat.belowTotal, 50);
  assert.equal(stat.paidTotal, 800);
  assert.equal(stat.noLowCount, 2); // D and "Zero low"; bundle is not compared
});
