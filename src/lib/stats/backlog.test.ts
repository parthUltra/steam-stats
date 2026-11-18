import assert from "node:assert/strict";
import { test } from "node:test";
import { backlog } from "./backlog";
import { NOW, game, makeInput, paidGame, purchase } from "./test-helpers";

test("backlog: null with no owned games and no paid titles", () => {
  assert.equal(backlog(makeInput()), null);
  assert.equal(
    backlog(makeInput({ playedGames: [game("Fam", 3, { fromFamily: true })] })),
    null,
  );
});

test("backlog: counts, cost, share and shelf age", () => {
  const stat = backlog(
    makeInput({
      playedGames: [
        game("Owned1", 0),
        game("Owned2", 0.2),
        game("Owned3", 10),
        game("Fam", 0, { fromFamily: true }),
      ],
      paidGames: [
        paidGame("Owned1", 500, 0),
        paidGame("Owned2", 300, 0.2),
        paidGame("Owned3", 1000, 10),
        paidGame("Mystery", 200, 0),
      ],
      purchases: [
        purchase("1 Jun, 2026", ["Owned1"], 500),
        purchase("1 May, 2026", ["Owned2", "Owned3"], 1300),
        // Refunded rows never date a title.
        purchase("1 Feb, 2026", ["Mystery"], 200, { refunded: true }),
      ],
    }),
  );
  assert.ok(stat);
  assert.equal(stat.asOf, NOW);
  assert.equal(stat.ownedCount, 3); // family title excluded
  assert.equal(stat.neverPlayedCount, 1);
  assert.equal(stat.barelyPlayedCount, 1);
  assert.equal(stat.paidCount, 3);
  assert.equal(stat.paidCost, 1000); // 500 + 300 + 200
  assert.equal(stat.paidTitlesTotal, 4);
  assert.equal(stat.paidTotal, 2000);
  assert.equal(stat.share, 0.5);
  assert.deepEqual(
    stat.rows.map((r) => r.title),
    ["Owned1", "Owned2", "Mystery"],
  );
  // Snapshot is 1 Jul 2026 at noon: 30.5 days after 1 Jun, 61.5 after 1 May.
  assert.equal(stat.rows[0].shelfDays, 30.5);
  assert.equal(stat.rows[1].shelfDays, 61.5);
  assert.equal(stat.rows[2].boughtAt, null);
  assert.equal(stat.rows[2].shelfDays, null);
  assert.equal(stat.medianShelfDays, 46);
});

test("backlog: line-item names take precedence over the cart label", () => {
  const stat = backlog(
    makeInput({
      paidGames: [paidGame("Inner Game", 400, 0)],
      purchases: [
        purchase("1 Jun, 2026", ["Some Bundle"], 400, {
          lineItems: [
            { name: "Inner Game", amount: 400, currencyHint: "INR", raw: "₹ 400" },
          ],
        }),
      ],
    }),
  );
  assert.ok(stat);
  assert.equal(stat.rows[0].shelfDays, 30.5);
  assert.equal(stat.share, 1);
  assert.equal(stat.ownedCount, 0);
});

test("backlog: everything played means an empty list, not null", () => {
  const stat = backlog(
    makeInput({
      playedGames: [game("A", 5)],
      paidGames: [paidGame("A", 100, 5)],
    }),
  );
  assert.ok(stat);
  assert.equal(stat.paidCount, 0);
  assert.equal(stat.paidCost, 0);
  assert.equal(stat.share, 0);
  assert.equal(stat.medianShelfDays, null);
});
