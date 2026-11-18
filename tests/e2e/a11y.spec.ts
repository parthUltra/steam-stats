/**
 * Accessibility smoke using Playwright only (no axe): structure, names and
 * keyboard reachability. It catches regressions, not every WCAG issue.
 */
import { expect, openDashboard, test } from "./fixtures";
import type { Page } from "playwright/test";

/** Interactive nodes in the accessibility tree that have no accessible name. */
async function unnamedControls(page: Page): Promise<string[]> {
  const snapshot = await page.locator("body").ariaSnapshot();
  return snapshot
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^- (button|link|tab|textbox|searchbox|checkbox|switch|combobox|img)(?: \[[^\]]*\])*:?$/.test(l));
}

for (const tab of ["Library", "Value"] as const) {
  test.describe(`accessibility smoke — ${tab} tab`, () => {
    test.beforeEach(async ({ page }) => {
      await openDashboard(page);
      if (tab === "Value") {
        await page.getByRole("tab", { name: "Value" }).click();
        await expect(page.getByTestId("kpi-net-spent")).toBeVisible();
      }
    });

    test("document has a language, a title and exactly one h1", async ({ page }) => {
      await expect(page.locator("html")).toHaveAttribute("lang", /^[a-z]{2}/);
      expect((await page.title()).trim().length).toBeGreaterThan(0);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    });

    test("every image has an alt attribute", async ({ page }) => {
      const missing = await page.locator("img:not([alt])").count();
      expect(missing).toBe(0);
    });

    test("every control has an accessible name", async ({ page }) => {
      expect(await unnamedControls(page)).toEqual([]);
    });

    test("the selected tab is exposed and owns a visible tab panel", async ({ page }) => {
      const selected = page.getByRole("tab", { selected: true });
      await expect(selected).toHaveCount(1);
      await expect(selected).toHaveText(tab);
      await expect(page.getByRole("tabpanel")).toBeVisible();
    });

    test("no element id is used twice", async ({ page }) => {
      const dupes = await page.evaluate(() => {
        const seen = new Map<string, number>();
        for (const el of document.querySelectorAll("[id]")) {
          seen.set(el.id, (seen.get(el.id) ?? 0) + 1);
        }
        return [...seen].filter(([, n]) => n > 1).map(([id]) => id);
      });
      expect(dupes).toEqual([]);
    });
  });
}

test.describe("accessibility smoke — keyboard", () => {
  test("Tab reaches interactive controls and shows a focus indicator", async ({ page }) => {
    await openDashboard(page);
    const visited: string[] = [];
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      const info = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const cs = getComputedStyle(el);
        const ring =
          (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) ||
          cs.boxShadow !== "none";
        return { tag: el.tagName.toLowerCase(), role: el.getAttribute("role"), ring };
      });
      expect(info, `Tab press ${i + 1} left focus on <body>`).not.toBeNull();
      expect(info!.ring, `focused <${info!.tag}> has no visible focus indicator`).toBe(true);
      visited.push(info!.role ?? info!.tag);
    }
    expect(visited.some((v) => v === "tab" || v === "button" || v === "a" || v === "input")).toBe(true);
  });

  test("the tab list is operable with arrow keys", async ({ page }) => {
    await openDashboard(page);
    await page.getByRole("tab", { name: "Library" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Value" })).toBeFocused();
    // Activation may be automatic or need Enter; either is valid.
    if ((await page.getByRole("tab", { name: "Value" }).getAttribute("aria-selected")) !== "true") {
      await page.keyboard.press("Enter");
    }
    await expect(page.getByRole("tab", { name: "Value" })).toHaveAttribute("aria-selected", "true");
  });

  test("the search box is labelled and reachable with the / shortcut", async ({ page }) => {
    await openDashboard(page);
    const search = page.getByLabel(/search games/i);
    await expect(search).toBeVisible();
    await page.locator("body").press("/");
    await expect(search).toBeFocused();
  });
});
