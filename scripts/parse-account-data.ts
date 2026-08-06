/**
 * Run parsers against samples/account-data and write JSON fixtures.
 * Usage: npm run parse:account-data
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  parseAccountDataHtml,
  summarizePurchases,
  type PurchaseHistoryRow,
} from "../src/lib/account-data/parsers";
import {
  parseGamesPlayedHtml,
  extractSteamIdFromGamesHtml,
} from "../src/lib/account-data/games-playtime";

const SAMPLES_DIR = path.resolve(__dirname, "..", "samples", "account-data");
const OUT_DIR = path.resolve(__dirname, "..", "samples", "parsed");

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const files = (await fs.readdir(SAMPLES_DIR)).filter((f) => f.endsWith(".html"));

  const summary: Record<string, unknown> = {};

  for (const file of files.sort()) {
    const html = await fs.readFile(path.join(SAMPLES_DIR, file), "utf8");

    if (file === "games-all.html" || file === "games-recent.html") {
      if (file !== "games-all.html") {
        console.log(`${file}: skipped (use games-all for playtime)`);
        continue;
      }
      const games = parseGamesPlayedHtml(html);
      const steamId = extractSteamIdFromGamesHtml(html);
      const existingPath = path.join(OUT_DIR, "games-played.json");
      let existingCount = 0;
      try {
        const prev = JSON.parse(await fs.readFile(existingPath, "utf8")) as {
          games?: unknown[];
        };
        existingCount = prev.games?.length ?? 0;
      } catch {
        // none
      }
      // Don't clobber a fuller Steam API / session library with HTML's ~25 cards
      if (existingCount > games.length) {
        console.log(
          `${file}: HTML has ${games.length} games; keeping existing games-played.json (${existingCount}). Run npm run fetch:owned-games to refresh full library.`,
        );
        summary[file] = {
          kind: "games-played",
          gameCount: existingCount,
          steamId,
          keptExisting: true,
        };
        continue;
      }
      const payload = { steamId, games, source: "account-data-html" };
      await fs.writeFile(existingPath, JSON.stringify(payload, null, 2), "utf8");
      const totalHours = games.reduce((s, g) => s + g.hoursForever, 0);
      summary[file] = {
        kind: "games-played",
        gameCount: games.length,
        totalHours,
        steamId,
      };
      console.log(
        `${file}: games-played ${games.length} games · ${totalHours.toFixed(1)}h · steamId=${steamId}`,
      );
      continue;
    }

    const result = parseAccountDataHtml(html);
    const outName = file.replace(/\.html$/, ".json");
    await fs.writeFile(
      path.join(OUT_DIR, outName),
      JSON.stringify(result, null, 2),
      "utf8",
    );

    if (result.kind === "purchase-history") {
      const stats = summarizePurchases(result.rows as PurchaseHistoryRow[]);
      summary[file] = { kind: result.kind, rowCount: result.rows.length, stats };
      console.log(
        `${file}: purchase-history ${result.rows.length} rows | spent≈${stats.spent} ${stats.currency} | refunds ${stats.refundCount}`,
      );
    } else if (result.kind === "unknown") {
      summary[file] = result;
      console.log(`${file}: UNKNOWN (${result.reason})`);
    } else {
      summary[file] = { kind: result.kind, rowCount: result.rows.length };
      console.log(`${file}: ${result.kind} ${result.rows.length} rows`);
    }
  }

  await fs.writeFile(
    path.join(OUT_DIR, "_summary.json"),
    JSON.stringify(summary, null, 2),
    "utf8",
  );

  // Merge transaction line-item prices if already fetched
  try {
    const historyPath = path.join(OUT_DIR, "purchase-history.json");
    const linesPath = path.join(OUT_DIR, "transaction-line-items.json");
    const history = JSON.parse(await fs.readFile(historyPath, "utf8")) as {
      kind: string;
      rows: PurchaseHistoryRow[];
    };
    const lines = JSON.parse(await fs.readFile(linesPath, "utf8")) as Record<
      string,
      import("../src/lib/account-data/parsers").PurchaseLineItem[]
    >;
    const { applyTransactionLineItems } = await import(
      "../src/lib/account-data/parsers"
    );
    history.rows = applyTransactionLineItems(history.rows, lines);
    await fs.writeFile(historyPath, JSON.stringify(history, null, 2), "utf8");
    console.log(
      `Merged line items into purchase-history (${Object.keys(lines).length} transactions)`,
    );
  } catch {
    // optional
  }

  console.log(`\nWrote parsed JSON to ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
