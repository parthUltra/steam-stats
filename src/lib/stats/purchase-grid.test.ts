import assert from "node:assert/strict";
import { test } from "node:test";
import { purchaseGrid } from "./purchase-grid";
import { makeInput, monthly } from "./test-helpers";

test("purchaseGrid: null without dated spend", () => {
  assert.equal(purchaseGrid(makeInput()), null);
  assert.equal(
    purchaseGrid(
      makeInput({
        monthly: monthly([
          ["unknown", 500, 1],
          ["2026-13", 500, 1],
        ]),
      }),
    ),
    null,
  );
});

test("purchaseGrid: year × month cells with empty years kept", () => {
  const stat = purchaseGrid(
    makeInput({
      monthly: monthly([
        ["2023-06", 600, 3],
        ["2023-07", 200, 1],
        ["2025-06", 100, 1],
        ["2025-01", 100, 1],
      ]),
    }),
  );
  assert.ok(stat);
  assert.deepEqual(stat.years, ["2023", "2024", "2025"]);
  assert.deepEqual(stat.cells[0][5], { spent: 600, count: 3 });
  assert.deepEqual(stat.cells[0][6], { spent: 200, count: 1 });
  assert.equal(stat.cells[1].every((c) => c.spent === 0 && c.count === 0), true);
  assert.deepEqual(stat.cells[2][5], { spent: 100, count: 1 });
  assert.deepEqual(stat.cells[2][0], { spent: 100, count: 1 });
  assert.deepEqual(stat.monthTotals, [100, 0, 0, 0, 0, 700, 200, 0, 0, 0, 0, 0]);
  assert.deepEqual(stat.yearTotals, [800, 0, 200]);
  assert.equal(stat.total, 1000);
  assert.equal(stat.maxCell, 600);
  assert.equal(stat.purchaseCount, 6);
  // June (700) + July (200) of 1000.
  assert.deepEqual(stat.topMonths, { monthIndexes: [5, 6], share: 0.9 });
});

test("purchaseGrid: a single month", () => {
  const stat = purchaseGrid(makeInput({ monthly: monthly([["2026-02", 250, 1]]) }));
  assert.ok(stat);
  assert.deepEqual(stat.years, ["2026"]);
  assert.deepEqual(stat.topMonths, { monthIndexes: [1], share: 1 });
});
