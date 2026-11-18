/**
 * Fetch Steam HelpWithTransaction pages for multi-item purchases
 * so we get real per-game paid amounts (not equal splits).
 *
 * Usage: npm run fetch:transactions
 * Requires an existing .steam-session from npm run fetch:account-data
 */
import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import {
  parsePurchaseHistory,
  parseTransactionDetailHtml,
  applyTransactionLineItems,
  type PurchaseLineItem,
} from "../src/lib/account-data/parsers";
import {
  ensurePrivateDir,
  writePrivateFile,
} from "../src/lib/process/private-files";
import { rootPath } from "../src/lib/runtime";

// Data root (honours STEAM_STATS_ROOT), the same one every reader uses.
const SAMPLES = rootPath("samples", "account-data");
const TX_DIR = path.join(SAMPLES, "transactions");
const PARSED = rootPath("samples", "parsed");
const STORAGE = rootPath(".steam-session", "storage-state.json");

async function main() {
  // Transaction pages are PII: owner-only.
  await ensurePrivateDir(TX_DIR);
  await ensurePrivateDir(PARSED);

  const historyHtml = await fs.readFile(
    path.join(SAMPLES, "purchase-history.html"),
    "utf8",
  );
  let rows = parsePurchaseHistory(historyHtml);

  // Fetch details for every purchase with a transaction id (line items even for singles)
  const targets = rows.filter((r) => r.transactionId && !r.refunded);
  console.log(`Fetching ${targets.length} transaction detail pages…`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: STORAGE });
  const page = await context.newPage();

  const byId: Record<string, PurchaseLineItem[]> = {};

  for (const row of targets) {
    const id = row.transactionId!;
    const outFile = path.join(TX_DIR, `${id}.html`);
    let html: string;
    try {
      await fs.access(outFile);
      html = await fs.readFile(outFile, "utf8");
      console.log(`  cache hit ${id}`);
    } catch {
      const url = `https://help.steampowered.com/en/wizard/HelpWithTransaction?transid=${id}`;
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForTimeout(800);
      html = await page.content();
      await writePrivateFile(outFile, html);
      console.log(`  fetched ${id}`);
    }
    const lines = parseTransactionDetailHtml(html);
    if (lines.length) {
      byId[id] = lines;
      console.log(
        `    → ${lines.map((l) => `${l.name}=${l.amount}`).join(", ")}`,
      );
    }
  }

  await browser.close();

  rows = applyTransactionLineItems(rows, byId);
  await writePrivateFile(
    path.join(PARSED, "purchase-history.json"),
    JSON.stringify({ kind: "purchase-history", rows }, null, 2),
  );
  await writePrivateFile(
    path.join(PARSED, "transaction-line-items.json"),
    JSON.stringify(byId, null, 2),
  );

  console.log("Done. Re-open the dashboard to see corrected paid amounts.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
