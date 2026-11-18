import { expect, openDashboard, test } from "./fixtures";

test.describe("help / glossary", () => {
  test("opens as a named dialog, takes focus, closes on Escape and returns focus", async ({ page }) => {
    await openDashboard(page);
    const opener = page.getByRole("button", { name: /help|glossary|shortcuts/i }).first();
    await opener.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // A dialog must have an accessible name.
    await expect(dialog).toHaveAccessibleName(/.+/);
    // It explains at least the keyboard shortcuts.
    await expect(dialog.getByText(/shortcut/i).first()).toBeVisible();
    // Focus moved into it.
    await expect
      .poll(() => dialog.evaluate((el) => el.contains(document.activeElement)))
      .toBe(true);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test("closes with its close button and can be reopened", async ({ page }) => {
    await openDashboard(page);
    const opener = page.getByRole("button", { name: /help|glossary|shortcuts/i }).first();
    await opener.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    await dialog.getByRole("button", { name: /close/i }).first().click();
    await expect(dialog).toBeHidden();

    await opener.click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("Tab never reaches the page behind the open dialog", async ({ page }) => {
    await openDashboard(page);
    await page.getByRole("button", { name: /help|glossary|shortcuts/i }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press("Tab");
      // Focus may rest on the dialog or on an invisible focus guard, but never
      // on a control of the page underneath.
      const behind = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        if (el.closest('[role="dialog"]')) return null;
        const inPage = el.closest('main, header, [role="banner"], [role="tabpanel"], nav');
        return inPage ? `<${el.tagName.toLowerCase()}> ${el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 40) ?? ""}` : null;
      });
      expect(behind, `Tab press ${i + 1} focused a control behind the dialog`).toBeNull();
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });
});
