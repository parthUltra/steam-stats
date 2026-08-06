import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

async function main() {
  const STORAGE = path.resolve(".steam-session/storage-state.json");
  const url =
    "https://help.steampowered.com/en/wizard/HelpWithTransaction?transid=384642474499070957";

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: STORAGE });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2500);
  const html = await page.content();
  await fs.mkdir("samples/account-data/transactions", { recursive: true });
  await fs.writeFile(
    "samples/account-data/transactions/384642474499070957.html",
    html,
  );
  console.log("saved", html.length, "url", page.url());
  const text = await page.locator("body").innerText();
  console.log(text.slice(0, 3000));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
