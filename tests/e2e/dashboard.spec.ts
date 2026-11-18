import { expect, expected, fetchPayload, numberIn, openDashboard, shows, test } from "./fixtures";

test.describe("dashboard renders the fixture", () => {
  test("first paint shows the library with the fixture's total hours", async ({ page }) => {
    await openDashboard(page);
    await expect(page).toHaveTitle(/steam stats/i);

    const shown = await numberIn(page.getByTestId("kpi-total-hours"));
    // Independent truth (hand-derived) …
    expect(shows(shown, expected.playtime.totalHours), `total hours shown: ${shown}`).toBe(true);
    // … and consistency with what this server computed.
    const payload = await fetchPayload(page);
    expect(shows(shown, payload.playtime.totalHours)).toBe(true);

    // Top game of the fixture is on screen.
    await expect(page.getByText("Starfall Tactics", { exact: true }).first()).toBeVisible();
  });

  test("Library and Value tabs switch and each shows its own content", async ({ page }) => {
    await openDashboard(page);
    const library = page.getByRole("tab", { name: "Library" });
    const value = page.getByRole("tab", { name: "Value" });

    await expect(library).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("kpi-total-hours")).toBeVisible();

    await value.click();
    await expect(value).toHaveAttribute("aria-selected", "true");
    await expect(library).toHaveAttribute("aria-selected", "false");
    await expect(page.getByTestId("kpi-net-spent")).toBeVisible();
    await expect(page.getByTestId("kpi-total-hours")).toBeHidden();

    await library.click();
    await expect(library).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("kpi-total-hours")).toBeVisible();
    await expect(page.getByTestId("kpi-net-spent")).toBeHidden();
  });

  test("Value tab shows the money figures the server computed", async ({ page }) => {
    await openDashboard(page);
    const payload = await fetchPayload(page);
    await page.getByRole("tab", { name: "Value" }).click();

    const spent = await numberIn(page.getByTestId("kpi-net-spent"));
    expect(shows(spent, payload.spending.netSpent), `net spent shown: ${spent}`).toBe(true);

    const slices = [
      payload.valuation.shelfFull,
      payload.valuation.shelfPaidOnly,
      payload.valuation.shelfExcludingReceivedGifts,
    ];
    const now = await numberIn(page.getByTestId("kpi-shelf-now"));
    expect(
      slices.some((s) => shows(now, s.current)),
      `shelf now shown: ${now}, server has ${slices.map((s) => s.current).join(" / ")}`,
    ).toBe(true);

    const lowest = await numberIn(page.getByTestId("kpi-shelf-lowest"));
    expect(
      slices.some((s) => shows(lowest, s.lowest)),
      `shelf lowest shown: ${lowest}, server has ${slices.map((s) => s.lowest).join(" / ")}`,
    ).toBe(true);

    const blended = payload.costPerHour.blendedCostPerHour;
    expect(blended).not.toBeNull();
    const perHour = await numberIn(page.getByTestId("kpi-cost-per-hour"));
    expect(Math.abs(perHour - blended!) <= 0.5, `cost/hr shown: ${perHour}, server has ${blended}`).toBe(true);
  });

  test("artwork renders offline from the fixture cache", async ({ page }) => {
    await openDashboard(page);
    const art = page.locator('img[src^="data:image/svg+xml"]');
    await expect(art.first()).toBeVisible();
    expect(await art.count()).toBeGreaterThan(5);
    const drawn = await art.first().evaluate(
      (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
    );
    expect(drawn).toBe(true);
  });

  test("a reload shows the same figures (server render and client agree)", async ({ page }) => {
    await openDashboard(page);
    const before = await numberIn(page.getByTestId("kpi-total-hours"));
    await page.reload();
    await expect(page.getByTestId("kpi-total-hours")).toBeVisible();
    expect(await numberIn(page.getByTestId("kpi-total-hours"))).toBe(before);
  });
});
