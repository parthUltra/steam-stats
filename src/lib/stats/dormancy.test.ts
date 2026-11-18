import assert from "node:assert/strict";
import { test } from "node:test";
import { dormancy } from "./dormancy";
import { NOW, daysAgo, game, makeInput } from "./test-helpers";

test("dormancy: null without played games or a snapshot time", () => {
  assert.equal(dormancy(makeInput()), null);
  assert.equal(dormancy(makeInput({ playedGames: [game("Zero", 0)] })), null);
  assert.equal(
    dormancy(
      makeInput({
        playedGames: [game("A", 5, { lastPlayedAt: daysAgo(3) })],
        now: 0,
      }),
    ),
    null,
  );
});

test("dormancy: buckets by idle time against the snapshot, not the clock", () => {
  const stat = dormancy(
    makeInput({
      playedGames: [
        game("A", 5, { lastPlayedAt: daysAgo(10) }),
        game("B", 20, { lastPlayedAt: daysAgo(100) }),
        game("C", 3, { lastPlayedAt: daysAgo(200) }),
        game("D", 40, { lastPlayedAt: daysAgo(400) }),
        game("E", 12, { lastPlayedAt: daysAgo(365) }),
        game("F", 2, { lastPlayedAt: null }),
        game("G", 0, { lastPlayedAt: daysAgo(1) }),
        game("H", 1, { lastPlayedAt: NOW + 86_400_000 }),
      ],
    }),
  );
  assert.ok(stat);
  assert.equal(stat.asOf, NOW);
  assert.equal(stat.playedCount, 7); // G has no hours
  assert.deepEqual(stat.buckets, [
    { id: "month", count: 2, hours: 6 }, // A, and H (stamp after snapshot)
    { id: "half", count: 1, hours: 20 }, // B
    { id: "year", count: 1, hours: 3 }, // C
    { id: "older", count: 2, hours: 52 }, // D, E (exactly 365 days)
    { id: "unknown", count: 1, hours: 2 }, // F
  ]);
  assert.deepEqual(
    stat.shelved.map((s) => s.name),
    ["D", "E"],
  );
  assert.equal(stat.shelvedCount, 2);
  assert.equal(stat.shelved[0].idleDays, 400);
});

test("dormancy: exact boundaries fall into the older bucket", () => {
  const stat = dormancy(
    makeInput({
      playedGames: [
        game("Thirty", 1, { lastPlayedAt: daysAgo(30) }),
        game("OneEighty", 1, { lastPlayedAt: daysAgo(180) }),
      ],
    }),
  );
  assert.ok(stat);
  assert.deepEqual(
    stat.buckets.map((b) => b.count),
    [0, 1, 1, 0, 0],
  );
  assert.deepEqual(stat.shelved, []);
});

test("dormancy: a long-idle game under ten hours is not 'shelved'", () => {
  const stat = dormancy(
    makeInput({ playedGames: [game("Brief", 9.9, { lastPlayedAt: daysAgo(900) })] }),
  );
  assert.ok(stat);
  assert.equal(stat.buckets[3].count, 1);
  assert.equal(stat.shelvedCount, 0);
});
