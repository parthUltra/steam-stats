import assert from "node:assert/strict";
import { test } from "node:test";
import { cumulativeSpend } from "./cumulative-spend";
import { makeInput, monthly } from "./test-helpers";

test("cumulativeSpend: null without dated spend", () => {
  assert.equal(cumulativeSpend(makeInput()), null);
  assert.equal(
    cumulativeSpend(makeInput({ monthly: monthly([["unknown", 500, 1]]) })),
    null,
  );
});

test("cumulativeSpend: quiet months are filled through the snapshot month", () => {
  const stat = cumulativeSpend(
    makeInput({
      monthly: monthly([
        ["2026-03", 300, 2],
        ["2026-05", 100, 1],
        ["2025-12", 600, 3],
      ]),
    }),
  );
  assert.ok(stat);
  // Dec 2025 → Jul 2026 (snapshot month) = 8 months.
  assert.deepEqual(
    stat.points.map((p) => [p.month, p.spent, p.cumulative]),
    [
      ["2025-12", 600, 600],
      ["2026-01", 0, 600],
      ["2026-02", 0, 600],
      ["2026-03", 300, 900],
      ["2026-04", 0, 900],
      ["2026-05", 100, 1000],
      ["2026-06", 0, 1000],
      ["2026-07", 0, 1000],
    ],
  );
  assert.equal(stat.total, 1000);
  assert.equal(stat.purchaseCount, 6);
  assert.equal(stat.activeMonths, 3);
  assert.equal(stat.quietMonths, 5);
  assert.deepEqual(stat.years, [
    { year: "2025", spent: 600, count: 3, share: 0.6 },
    { year: "2026", spent: 400, count: 3, share: 0.4 },
  ]);
  assert.deepEqual(stat.topYear, { year: "2025", spent: 600, share: 0.6 });
  assert.deepEqual(stat.topMonth, { month: "2025-12", spent: 600, share: 0.6 });
});

test("cumulativeSpend: one month, snapshot earlier than the purchase", () => {
  const stat = cumulativeSpend(
    makeInput({
      monthly: monthly([["2026-09", 250, 1]]),
      now: new Date(2026, 6, 1).getTime(),
    }),
  );
  assert.ok(stat);
  assert.deepEqual(stat.points, [
    { month: "2026-09", spent: 250, count: 1, cumulative: 250 },
  ]);
  assert.equal(stat.quietMonths, 0);
  assert.equal(stat.topYear.share, 1);
});
