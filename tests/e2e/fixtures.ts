/**
 * Shared Playwright fixtures for the functional gate.
 *
 * Every test automatically:
 *  - blocks and records any request that would leave 127.0.0.1,
 *  - records console errors and uncaught page errors,
 * and fails afterwards if either list is non-empty.
 */
import fs from "node:fs";
import path from "node:path";
import { test as base, expect, type Locator, type Page } from "playwright/test";

export { expect };

export type Guard = {
  /** URLs the page tried to load from anywhere but the test server */
  external: string[];
  /** console.error output and uncaught exceptions */
  errors: string[];
};

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

export const test = base.extend<{ guard: Guard }>({
  guard: [
    async ({ context, page }, use) => {
      const guard: Guard = { external: [], errors: [] };

      await context.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (LOOPBACK.has(url.hostname)) return route.continue();
        guard.external.push(`${route.request().method()} ${url.origin}${url.pathname}`);
        return route.abort("blockedbyclient");
      });

      page.on("console", (msg) => {
        if (msg.type() !== "error") return;
        const text = msg.text();
        // The abort above surfaces as a console error; it is reported through
        // `external`, which names the URL.
        if (/ERR_BLOCKED_BY_CLIENT/.test(text)) return;
        guard.errors.push(`console.error: ${text}`);
      });
      page.on("pageerror", (err) => {
        guard.errors.push(`uncaught: ${err.message}`);
      });

      await use(guard);

      expect(guard.external, "requests leaving 127.0.0.1").toEqual([]);
      expect(guard.errors, "console errors / uncaught exceptions").toEqual([]);
    },
    { auto: true },
  ],
});

/** Hand-derived truth for the fixture (tests/fixtures/library-a/expected.json). */
export const expected = JSON.parse(
  fs.readFileSync(
    path.resolve("tests", "fixtures", "library-a", "expected.json"),
    "utf8",
  ),
) as {
  playtime: { totalHours: number; gameCount: number };
  spending: { netSpent: number };
};

/** What the server under test actually computed — the UI must show this. */
export type Payload = {
  playtime: { totalHours: number; games: { appId: number; name: string; hoursForever: number }[] };
  spending: { netSpent: number };
  valuation: Record<
    "shelfFull" | "shelfPaidOnly" | "shelfExcludingReceivedGifts",
    { current: number; lowest: number }
  > &
    Record<string, unknown>;
  costPerHour: { blendedCostPerHour: number | null };
};

export async function fetchPayload(page: Page): Promise<Payload> {
  const res = await page.request.get("/api/dashboard");
  expect(res.status()).toBe(200);
  return (await res.json()) as Payload;
}

/** Open the dashboard and wait until it has rendered data. */
export async function openDashboard(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Library" })).toBeVisible();
  await expect(page.getByTestId("kpi-total-hours")).toBeVisible();
}

/**
 * First number in an element's text: "₹22,615" → 22615, "2,492.5 hrs" → 2492.5,
 * "₹22.6K" → 22600. Formatting may change with the redesign; the value may not.
 */
export async function numberIn(locator: Locator): Promise<number> {
  const text = ((await locator.textContent()) ?? "").replace(/ /g, " ");
  const m = text.replace(/,/g, "").match(/(-?\d+(?:\.\d+)?)\s*([KkLlMm])?/);
  expect(m, `no number in "${text}"`).not.toBeNull();
  const n = Number(m![1]);
  const unit = (m![2] ?? "").toLowerCase();
  return unit === "k" ? n * 1e3 : unit === "l" ? n * 1e5 : unit === "m" ? n * 1e6 : n;
}

/** True when `shown` is `value` as displayed: exact, rounded, or abbreviated (≤1 %). */
export function shows(shown: number, value: number): boolean {
  return Math.abs(shown - value) <= Math.max(1, Math.abs(value) * 0.01);
}

/**
 * App ids of the games on the Library shelf, in document order.
 *
 * Contract with the UI lane, in order of preference:
 *  1. each shelf entry carries `data-testid="game-card"` + `data-app-id`, or
 *  2. the shelf is a list whose accessible name is exactly "Games" and whose
 *     items' accessible names start with the game title (today's markup), or
 *  3. each entry links to its Steam store page (the pre-redesign markup).
 * When a game appears twice (hero + grid), its last occurrence counts.
 */
export async function shelfOrder(page: Page): Promise<number[]> {
  const panel = page.getByRole("tabpanel").first();
  const found = await panel.evaluate((root) => {
    const cards = [...root.querySelectorAll('[data-testid="game-card"][data-app-id]')];
    if (cards.length) {
      return { ids: cards.map((el) => Number(el.getAttribute("data-app-id"))), labels: null };
    }
    const lists = [...root.querySelectorAll('[role="list"], ul, ol')].filter((el) =>
      /^(games|game shelf|shelf)$/i.test((el.getAttribute("aria-label") ?? "").trim()),
    );
    if (lists.length) {
      const labels = lists.flatMap((list) =>
        [...list.querySelectorAll('[role="listitem"], li')].map((li) => {
          const control = li.querySelector("button, a");
          return (
            control?.getAttribute("aria-label") ??
            control?.textContent ??
            li.textContent ??
            ""
          ).trim();
        }),
      );
      return { ids: null, labels };
    }
    const links = [...root.querySelectorAll('a[href*="store.steampowered.com/app/"]')];
    return {
      ids: links
        .map((el) => el.getAttribute("href")!.match(/\/app\/(\d+)/)?.[1])
        .filter((v): v is string => Boolean(v))
        .map(Number),
      labels: null,
    };
  });

  let ids = found.ids ?? [];
  if (found.labels) {
    const games = (await fetchPayload(page)).playtime.games
      .map((g) => ({ id: g.appId, name: g.name }))
      .sort((a, b) => b.name.length - a.name.length); // longest title wins
    ids = found.labels.map((label) => {
      const hit =
        games.find((g) => label.startsWith(`${g.name},`)) ??
        games.find((g) => label.startsWith(g.name));
      expect(hit, `shelf entry "${label}" is not a game the server reported`).toBeTruthy();
      return hit!.id;
    });
  }

  const lastIndex = new Map<number, number>();
  ids.forEach((id, i) => lastIndex.set(id, i));
  return [...lastIndex.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
}
