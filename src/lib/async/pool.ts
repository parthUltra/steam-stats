/**
 * Lightweight async concurrency helpers for I/O-bound Steam/CheapShark work.
 * Prefer these over worker_threads — fetch already overlaps on the event loop.
 */

export async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!, i);
    }
  }

  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

export type RateLimiter = {
  /** Wait until the next slot is available, then claim it. */
  schedule: <T>(fn: () => Promise<T>) => Promise<T>;
};

/**
 * Min-interval limiter: at most one start every `minIntervalMs`.
 * Concurrent callers queue; each waits its turn then runs.
 */
export function createRateLimiter(minIntervalMs: number): RateLimiter {
  let chain: Promise<unknown> = Promise.resolve();
  let lastStart = 0;

  function schedule<T>(fn: () => Promise<T>): Promise<T> {
    const run = chain.then(async () => {
      const now = Date.now();
      const wait = Math.max(0, minIntervalMs - (now - lastStart));
      if (wait > 0) {
        await new Promise((r) => setTimeout(r, wait));
      }
      lastStart = Date.now();
      return fn();
    });
    // Keep the chain alive even if fn rejects
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  return { schedule };
}

/** Shared Steam store limiter (~8–10 req/s peak across workers). */
export const steamRateLimiter = createRateLimiter(110);

/** CheapShark is strict on rate limits — keep well under their throttle. */
export const cheapSharkRateLimiter = createRateLimiter(250);
