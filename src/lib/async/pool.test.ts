import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createRateLimiter, createWindowRateLimiter } from "./pool";

const saved = process.env.STEAM_STATS_NO_PACING;
afterEach(() => {
  if (saved === undefined) delete process.env.STEAM_STATS_NO_PACING;
  else process.env.STEAM_STATS_NO_PACING = saved;
});

async function elapsed(run: () => Promise<unknown>): Promise<number> {
  const t0 = performance.now();
  await run();
  return performance.now() - t0;
}

const three = (limiter: { schedule: <T>(fn: () => Promise<T>) => Promise<T> }) =>
  Promise.all([1, 2, 3].map((n) => limiter.schedule(async () => n)));

describe("rate limiters", () => {
  it("space out starts by the minimum interval", async () => {
    delete process.env.STEAM_STATS_NO_PACING;
    // 3 starts, 2 gaps of 40 ms
    assert.ok((await elapsed(() => three(createRateLimiter(40)))) >= 75);
    assert.ok((await elapsed(() => three(createWindowRateLimiter(10, 1000, 40)))) >= 75);
  });

  it("hold back once the window is full", async () => {
    delete process.env.STEAM_STATS_NO_PACING;
    // 2 per 120 ms: the third start waits for the window
    assert.ok((await elapsed(() => three(createWindowRateLimiter(2, 120)))) >= 110);
  });

  it("do not wait at all when pacing is switched off (stubbed-network tests)", async () => {
    process.env.STEAM_STATS_NO_PACING = "1";
    assert.ok((await elapsed(() => three(createRateLimiter(5_000)))) < 500);
    assert.ok(
      (await elapsed(() => three(createWindowRateLimiter(1, 60_000, 5_000)))) < 500,
    );
  });

  it("still run tasks in order and survive a rejection", async () => {
    process.env.STEAM_STATS_NO_PACING = "1";
    const limiter = createRateLimiter(1);
    const order: number[] = [];
    const results = await Promise.allSettled([
      limiter.schedule(async () => order.push(1)),
      limiter.schedule(async () => {
        throw new Error("boom");
      }),
      limiter.schedule(async () => order.push(3)),
    ]);
    assert.deepEqual(order, [1, 3]);
    assert.equal(results[1].status, "rejected");
  });
});
