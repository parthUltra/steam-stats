import assert from "node:assert/strict";
import { test } from "node:test";
import { hoursBySource } from "./hours-by-source";
import { game, makeInput, shelfGame } from "./test-helpers";

test("hoursBySource: null without any hours", () => {
  assert.equal(hoursBySource(makeInput()), null);
  assert.equal(hoursBySource(makeInput({ playedGames: [game("Zero", 0)] })), null);
});

test("hoursBySource: groups by family flag, then shelf kind, else unattributed", () => {
  const stat = hoursBySource(
    makeInput({
      playedGames: [
        game("P", 100, { appId: 10 }),
        game("G", 50, { appId: 11 }),
        game("F", 30, { appId: 14, fromFamily: true }),
        game("U", 20, { appId: 12 }),
        game("Z", 0, { appId: 13 }),
      ],
      valuationGames: [
        shelfGame("Renamed on the shelf", { steamAppId: 10, kind: "purchased" }),
        shelfGame("g", { kind: "gifted_to_me" }), // matched by exact title
        // A gift sent to someone else never explains hours in this library.
        shelfGame("Sent", { steamAppId: 12, kind: "gifted_by_me" }),
      ],
    }),
  );
  assert.ok(stat);
  assert.equal(stat.totalHours, 200);
  assert.deepEqual(stat.rows, [
    { source: "purchased", titles: 1, played: 1, hours: 100, share: 0.5 },
    { source: "gifted_to_me", titles: 1, played: 1, hours: 50, share: 0.25 },
    { source: "family", titles: 1, played: 1, hours: 30, share: 0.15 },
    { source: "unattributed", titles: 2, played: 1, hours: 20, share: 0.1 },
  ]);
  assert.equal(stat.unattributedShare, 0.1);
});

test("hoursBySource: a single purchased game leaves nothing unattributed", () => {
  const stat = hoursBySource(
    makeInput({
      playedGames: [game("Only", 8)],
      valuationGames: [shelfGame("Only")],
    }),
  );
  assert.ok(stat);
  assert.equal(stat.rows.length, 1);
  assert.equal(stat.rows[0].share, 1);
  assert.equal(stat.unattributedShare, 0);
});

test("hoursBySource: owned-with-no-purchase hours count as unexplained too", () => {
  const stat = hoursBySource(
    makeInput({
      playedGames: [
        game("Bought", 60, { appId: 1 }),
        game("Owned somehow", 30, { appId: 2 }),
        game("No record", 10, { appId: 3 }),
      ],
      valuationGames: [
        shelfGame("Bought", { steamAppId: 1, kind: "purchased" }),
        shelfGame("Owned somehow", { steamAppId: 2, kind: "unknown_unpaid" }),
      ],
    }),
  );
  assert.ok(stat);
  assert.equal(stat.unattributedShare, 0.1);
  assert.equal(stat.otherOwnedShare, 0.3);
  // Neither group says how the game was acquired: together they are the gap.
  assert.equal(stat.unexplainedShare, 0.4);
});

test("hoursBySource: nothing unexplained when every game has a source", () => {
  const stat = hoursBySource(
    makeInput({
      playedGames: [game("Only", 8)],
      valuationGames: [shelfGame("Only")],
    }),
  );
  assert.ok(stat);
  assert.equal(stat.otherOwnedShare, 0);
  assert.equal(stat.unexplainedShare, 0);
});
