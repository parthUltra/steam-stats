/**
 * Run parsers against samples/account-data and write JSON fixtures.
 * Usage: npm run parse:account-data
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  applyTransactionLineItems,
  parseAccountDataHtml,
  parseLicensePages,
  summarizePurchases,
  type AccountDataParseResult,
  type PurchaseHistoryRow,
  type PurchaseLineItem,
} from "../src/lib/account-data/parsers";
import {
  parseGamesPlayedHtml,
  extractSteamIdFromGamesHtml,
  mergePlayedGames,
  type PlayedGame,
} from "../src/lib/account-data/games-playtime";
import {
  licensePageFiles,
  licenseWalkWasInterrupted,
} from "../src/lib/account-data/pagination";
import { writeJsonAtomic } from "../src/lib/data/json-store";
import { readTransactionLineItems } from "../src/lib/data/load-local";
import { rootPath } from "../src/lib/runtime";

// Data root honours STEAM_STATS_ROOT so fixtures can be regenerated with this script.
const SAMPLES_DIR = rootPath("samples", "account-data");
const OUT_DIR = rootPath("samples", "parsed");

type GamesPlayedFile = {
  steamId?: string | null;
  source?: string;
  fetchedAt?: string;
  games?: PlayedGame[];
};

/** When the fetcher saved `<id>.html`, from its `<id>.meta.json` (else the file's mtime). */
async function savedAtOf(file: string): Promise<string | null> {
  const id = file.replace(/\.html$/, "");
  try {
    const meta = JSON.parse(
      await fs.readFile(path.join(SAMPLES_DIR, `${id}.meta.json`), "utf8"),
    ) as { savedAt?: string };
    if (meta.savedAt && Number.isFinite(Date.parse(meta.savedAt))) {
      return meta.savedAt;
    }
  } catch {
    // no meta
  }
  try {
    return (await fs.stat(path.join(SAMPLES_DIR, file))).mtime.toISOString();
  } catch {
    return null;
  }
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const files = (await fs.readdir(SAMPLES_DIR)).filter((f) => f.endsWith(".html"));

  const summary: Record<string, unknown> = {};
  const gamesHtmlFiles = files.filter(
    (f) => f === "games-all.html" || f === "games-recent.html",
  );
  const skipParse = new Set([
    "accountdata-index.html",
    "account.html",
    "games-all.html",
    "games-recent.html",
  ]);
  // licenses.html, licenses-2.html, … are pages of one list (see below).
  const licensePages = licensePageFiles(files);
  const otherFiles = files.filter(
    (f) => !skipParse.has(f) && (f === "licenses.html" || !licensePages.includes(f)),
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
    let htmlSavedAt: string | null = null;

    for (const file of ["games-all.html", "games-recent.html"] as const) {
      if (!gamesHtmlFiles.includes(file)) continue;
      const html = await fs.readFile(path.join(SAMPLES_DIR, file), "utf8");
      const savedAt = await savedAtOf(file);
      if (savedAt && (!htmlSavedAt || savedAt > htmlSavedAt)) htmlSavedAt = savedAt;
      // Year-less labels ("14 Jul", "Today") are resolved against when the
      // page was saved, never against when this script runs.
      const games = parseGamesPlayedHtml(html, savedAt);
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
    // `fetchedAt` is when the newest data in the file was fetched from Steam —
    // never "now": re-running this parser must not make an old snapshot look
    // fresh, and year-less dates are resolved against it later.
    const fetchedAt =
      [existing.fetchedAt, htmlSavedAt]
        .filter((t): t is string => Boolean(t) && Number.isFinite(Date.parse(t!)))
        .sort((a, b) => Date.parse(a) - Date.parse(b))
        .pop() ?? null;
    const payload = {
      steamId,
      source,
      ...(fetchedAt ? { fetchedAt } : {}),
      games: merged,
    };
    await writeJsonAtomic(existingPath, payload);
    const totalHours = merged.reduce((s, g) => s + g.hoursForever, 0);
    const withRecent = merged.filter((g) => (g.lastPlayedAt ?? 0) > 0).length;
    console.log(
      `games-played: ${merged.length} games · ${totalHours.toFixed(1)}h · ${withRecent} with last-played · steamId=${steamId}`,
    );
  }

  let interruptedLicenseWalk = false;
  try {
    interruptedLicenseWalk = licenseWalkWasInterrupted(
      JSON.parse(await fs.readFile(path.join(SAMPLES_DIR, "_manifest.json"), "utf8")),
    );
  } catch {
    // no manifest: nothing recorded about the walk
  }

  for (const file of otherFiles.sort()) {
    const html = await fs.readFile(path.join(SAMPLES_DIR, file), "utf8");
    let result: AccountDataParseResult = parseAccountDataHtml(html, file);
    if (result.kind === "licenses" && licensePages.length > 1) {
      // The licences list is paginated; join every saved page.
      result = parseLicensePages(
        await Promise.all(
          licensePages.map((f) => fs.readFile(path.join(SAMPLES_DIR, f), "utf8")),
        ),
      );
    }
    if (result.kind === "licenses" && interruptedLicenseWalk) {
      // Fresh pages 1..k plus older later pages parse as a whole list; the
      // fetcher's manifest knows the walk did not finish.
      result = {
        ...result,
        status: "partial",
        reason:
          "the last fetch was interrupted before every licence page was saved — re-run: npm run fetch:account-data",
      };
    }
    const outName = file.replace(/\.html$/, ".json");
    const outPath = path.join(OUT_DIR, outName);

    if (result.kind === "unknown") {
      let keptExisting = false;
      try {
        const prev = JSON.parse(await fs.readFile(outPath, "utf8")) as {
          kind?: string;
          rows?: unknown[];
        };
        if (prev.kind && prev.kind !== "unknown" && (prev.rows?.length ?? 0) > 0) {
          keptExisting = true;
          // Keep the older rows, but record why they were not replaced so the
          // dashboard can ask for a re-fetch ("login-required").
          await writeJsonAtomic(outPath, {
            ...prev,
            status: result.status,
            reason: result.reason,
          });
          summary[file] = {
            ...result,
            keptExisting: true,
            existingKind: prev.kind,
            existingRows: prev.rows?.length,
          };
          console.log(
            `${file}: ${result.reason}; keeping existing ${prev.kind} (${prev.rows?.length} rows)`,
          );
        }
      } catch {
        // none
      }
      if (!keptExisting) {
        await writeJsonAtomic(outPath, result);
        summary[file] = result;
        console.log(`${file}: skipped (${result.reason})`);
      }
      continue;
    }

    await writeJsonAtomic(outPath, result);

    if (result.kind === "purchase-history") {
      const stats = summarizePurchases(result.rows);
      summary[file] = {
        kind: result.kind,
        status: result.status,
        rowCount: result.rows.length,
        stats,
      };
      console.log(
        `${file}: purchase-history ${result.rows.length} rows | spent≈${stats.spent} ${stats.currency} | refunds ${stats.refundCount}`,
      );
    } else {
      summary[file] = {
        kind: result.kind,
        status: result.status,
        rowCount: result.rows.length,
        ...(result.kind === "licenses" && result.pagination
          ? { pagination: result.pagination, pages: licensePages.length }
          : {}),
      };
      console.log(`${file}: ${result.kind} ${result.rows.length} rows`);
    }
    if (result.status === "partial") {
      const c = result.kind === "licenses" ? result.coverage : undefined;
      console.warn(
        `${file}: INCOMPLETE — ${
          c?.recordsTotal
            ? `${c.pagesSaved} saved page(s) cover ${c.recordsCovered} of ${c.recordsTotal} licence records`
            : "the page still has more rows to load"
        }. Re-run the fetch so every page is saved.`,
      );
    }
  }

  await writeJsonAtomic(path.join(OUT_DIR, "_summary.json"), summary);

  // Merge transaction line-item prices if already fetched: the saved detail
  // pages are the source; transaction-line-items.json fills in for pages that
  // are no longer on disk.
  try {
    const historyPath = path.join(OUT_DIR, "purchase-history.json");
    const linesPath = path.join(OUT_DIR, "transaction-line-items.json");
    const history = JSON.parse(await fs.readFile(historyPath, "utf8")) as {
      kind: string;
      rows: PurchaseHistoryRow[];
    };
    let saved: Record<string, PurchaseLineItem[]> = {};
    try {
      saved = JSON.parse(await fs.readFile(linesPath, "utf8")) as Record<
        string,
        PurchaseLineItem[]
      >;
    } catch {
      // none yet
    }
    const fromPages = await readTransactionLineItems(
      path.join(SAMPLES_DIR, "transactions"),
    );
    const lines = { ...saved, ...fromPages };
    if (!Object.keys(lines).length) throw new Error("no line items");
    if (Object.keys(fromPages).some((id) => !(id in saved))) {
      await writeJsonAtomic(linesPath, lines);
    }
    history.rows = applyTransactionLineItems(history.rows, lines);
    await writeJsonAtomic(historyPath, history);
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
