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

/**
 * Sliding-window limiter: at most `maxRequests` starts in any `windowMs` span,
 * with an optional minimum gap between starts (avoids bursting into 429s).
 */
export function createWindowRateLimiter(
  maxRequests: number,
  windowMs: number,
  minIntervalMs = 0,
): RateLimiter {
  const starts: number[] = [];
  let chain: Promise<unknown> = Promise.resolve();
  let lastStart = 0;

  function schedule<T>(fn: () => Promise<T>): Promise<T> {
    const run = chain.then(async () => {
      for (;;) {
        const now = Date.now();
        while (starts.length > 0 && starts[0]! <= now - windowMs) {
          starts.shift();
        }
        const gapWait = Math.max(0, minIntervalMs - (now - lastStart));
        if (starts.length < maxRequests && gapWait <= 0) {
          lastStart = now;
          starts.push(now);
          break;
        }
        const windowWait =
          starts.length >= maxRequests
            ? starts[0]! + windowMs - now + 5
            : 0;
        const wait = Math.max(gapWait, windowWait, 5);
        await new Promise((r) => setTimeout(r, wait));
      }
      return fn();
    });
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

/**
 * IsThereAnyDeal — account limit is 100 req / 5 min.
 * Prefer bulk endpoints (1 lookup + 1 prices/v3 per batch) so this stays spare.
 */
export const itadRateLimiter = createWindowRateLimiter(
  95,
  5 * 60 * 1000,
  3_000,
);
