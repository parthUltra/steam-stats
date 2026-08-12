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
  mergePlayedGames,
  type PlayedGame,
} from "../src/lib/account-data/games-playtime";

const SAMPLES_DIR = path.resolve(__dirname, "..", "samples", "account-data");
const OUT_DIR = path.resolve(__dirname, "..", "samples", "parsed");

type GamesPlayedFile = {
  steamId?: string | null;
  source?: string;
  fetchedAt?: string;
  games?: PlayedGame[];
};

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const files = (await fs.readdir(SAMPLES_DIR)).filter((f) => f.endsWith(".html"));

  const summary: Record<string, unknown> = {};
  const gamesHtmlFiles = files.filter(
    (f) => f === "games-all.html" || f === "games-recent.html",
  );
  const otherFiles = files.filter(
    (f) => f !== "games-all.html" && f !== "games-recent.html",
  );

  if (gamesHtmlFiles.length) {
    const existingPath = path.join(OUT_DIR, "games-played.json");
    let existing: GamesPlayedFile = {};
    try {
      existing = JSON.parse(await fs.readFile(existingPath, "utf8")) as GamesPlayedFile;
    } catch {
      // none
    }

    let merged = existing.games ?? [];
    let steamId = existing.steamId ?? null;
    const fromHtml: PlayedGame[] = [];

    for (const file of ["games-all.html", "games-recent.html"]) {
      if (!gamesHtmlFiles.includes(file)) continue;
      const html = await fs.readFile(path.join(SAMPLES_DIR, file), "utf8");
      const games = parseGamesPlayedHtml(html);
      steamId = extractSteamIdFromGamesHtml(html) ?? steamId;
      fromHtml.push(...games);
      console.log(`${file}: parsed ${games.length} games for playtime merge`);
      summary[file] = { kind: "games-played", gameCount: games.length, steamId };
    }

    merged = mergePlayedGames(merged, fromHtml);
    const source =
      (existing.games?.length ?? 0) > fromHtml.length
        ? existing.source === "account-data-html"
          ? "merged"
          : existing.source ?? "merged"
        : "account-data-html";
    const payload = {
      steamId,
      source,
      fetchedAt: new Date().toISOString(),
      games: merged,
    };
    await fs.writeFile(existingPath, JSON.stringify(payload, null, 2), "utf8");
    const totalHours = merged.reduce((s, g) => s + g.hoursForever, 0);
    const withRecent = merged.filter((g) => (g.lastPlayedAt ?? 0) > 0).length;
    console.log(
      `games-played: ${merged.length} games · ${totalHours.toFixed(1)}h · ${withRecent} with last-played · steamId=${steamId}`,
    );
  }

  for (const file of otherFiles.sort()) {
    const html = await fs.readFile(path.join(SAMPLES_DIR, file), "utf8");

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
