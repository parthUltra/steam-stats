import assert from "node:assert/strict";
import { test } from "node:test";
import { discountDepth } from "./discount-depth";
import { discounted, makeInput, purchase } from "./test-helpers";

test("discountDepth: null without library purchases", () => {
  assert.equal(discountDepth(makeInput()), null);
  assert.equal(
    discountDepth(
      makeInput({
        purchases: [
          purchase("1 May, 2026", ["Refunded"], 999, { refunded: true }),
          purchase("1 May, 2026", ["For a friend"], 500, { isGift: true }),
          purchase("1 May, 2026", ["Refund"], 999, { type: "Refund" }),
        ],
      }),
    ),
    null,
  );
});

test("discountDepth: bins per checkout and paid as a share of list", () => {
  const stat = discountDepth(
    makeInput({
      purchases: [
        discounted("1 May, 2026", ["A"], 1000, 250), // 75% off
        discounted("2 May, 2026", ["B"], 400, 300), // 25% off
        purchase("3 May, 2026", ["C"], 500), // full price
        discounted("4 May, 2026", ["D"], 1000, 100), // 90% off
        purchase("5 May, 2026", ["Refunded"], 999, { refunded: true }),
        purchase("6 May, 2026", ["Gifted away"], 700, { isGift: true }),
      ],
    }),
  );
  assert.ok(stat);
  assert.equal(stat.purchaseCount, 4);
  assert.equal(stat.discountedCount, 3);
  assert.deepEqual(stat.bins, [
    { id: "full", count: 1, paid: 500 },
    { id: "1-25", count: 1, paid: 300 },
    { id: "26-50", count: 0, paid: 0 },
    { id: "51-75", count: 1, paid: 250 },
    { id: "76-100", count: 1, paid: 100 },
  ]);
  assert.equal(stat.medianDiscountPct, 75); // 25, 75, 90
  assert.equal(stat.paidTotal, 1150);
  assert.equal(stat.listTotal, 2900); // 1000 + 400 + 500 + 1000
  assert.ok(Math.abs(stat.paidShareOfList - 1150 / 2900) < 1e-12);
});

test("discountDepth: a single full-price purchase", () => {
  const stat = discountDepth(
    makeInput({ purchases: [purchase("3 May, 2026", ["C"], 500)] }),
  );
  assert.ok(stat);
  assert.equal(stat.discountedCount, 0);
  assert.equal(stat.medianDiscountPct, null);
  assert.equal(stat.paidShareOfList, 1);
});
