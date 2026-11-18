import { expect, fetchPayload, openDashboard, shelfOrder, test } from "./fixtures";

const STARFALL = 9000001; // 412.5 h — most played
const EMBERWAKE = 9000002; // 286 h
const ANVIL = 9000023; // "Anvil Saga…" — first alphabetically
const LANTERN_MATCHES = [9000004, 9000024, 9000025]; // Paper Lanterns™, Lanternfall, Lanternfall Remnant

const before = (order: number[], a: number, b: number) =>
  order.indexOf(a) !== -1 && order.indexOf(b) !== -1 && order.indexOf(a) < order.indexOf(b);

test.describe("library shelf", () => {
  test("lists every game the server reports", async ({ page }) => {
    await openDashboard(page);
    const payload = await fetchPayload(page);
    const order = await shelfOrder(page);
    expect(new Set(order)).toEqual(new Set(payload.playtime.games.map((g) => g.appId)));
  });

  test("search filters the shelf and clearing it restores the list", async ({ page }) => {
    await openDashboard(page);
    const all = await shelfOrder(page);
    const search = page.getByLabel(/search games/i);

    await search.fill("lantern");
    await expect.poll(async () => (await shelfOrder(page)).length).toBeLessThan(all.length);
    const filtered = await shelfOrder(page);
    // Exactly the titles the server reports that contain the query…
    const matching = (await fetchPayload(page)).playtime.games
      .filter((g) => g.name.toLowerCase().includes("lantern"))
      .map((g) => g.appId)
      .sort();
    expect([...filtered].sort()).toEqual(matching);
    // …which must include the three fixture games with "lantern" in the name.
    for (const id of LANTERN_MATCHES) expect(filtered).toContain(id);
    await expect(page.getByText("Lanternfall Remnant", { exact: true }).first()).toBeVisible();

    await search.fill("zzz-no-such-game");
    await expect.poll(async () => (await shelfOrder(page)).length).toBe(0);
    // An empty result says so in words (wording is free).
    await expect(page.getByText(/no (games|titles) match|nothing .*match/i).first()).toBeVisible();

    await search.fill("");
    await expect.poll(async () => (await shelfOrder(page)).length).toBe(all.length);
  });

  test("search ignores case and the trademark sign", async ({ page }) => {
    await openDashboard(page);
    await page.getByLabel(/search games/i).fill("PAPER LANTERNS");
    await expect.poll(async () => await shelfOrder(page)).toEqual([9000004]);
  });

  test("sort toggles reorder the shelf: hours, A–Z, recent", async ({ page }) => {
    await openDashboard(page);
    // Named buttons, whichever group the design puts them in.
    const sortBy = (name: string) => page.getByRole("button", { name, exact: true });

    // Default: most played first.
    const byHours = await shelfOrder(page);
    expect(byHours[0]).toBe(STARFALL);
    expect(before(byHours, STARFALL, EMBERWAKE)).toBe(true);
    expect(before(byHours, EMBERWAKE, ANVIL)).toBe(true);

    await sortBy("A–Z").click();
    await expect.poll(async () => (await shelfOrder(page))[0]).toBe(ANVIL);
    const byName = await shelfOrder(page);
    expect(before(byName, ANVIL, EMBERWAKE)).toBe(true);
    expect(before(byName, EMBERWAKE, STARFALL)).toBe(true);
    expect(byName).not.toEqual(byHours);
    expect(new Set(byName)).toEqual(new Set(byHours));

    // Recent: Kestrel Run (14 Oct 2026) was played after Starfall Tactics (12 Oct).
    await sortBy("Recent").click();
    await expect.poll(async () => (await shelfOrder(page))[0]).toBe(9000014);
    const byRecent = await shelfOrder(page);
    expect(before(byRecent, 9000014, STARFALL)).toBe(true);

    await sortBy("Hours").click();
    await expect.poll(async () => await shelfOrder(page)).toEqual(byHours);
  });
});
