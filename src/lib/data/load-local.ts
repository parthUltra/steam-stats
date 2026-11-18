import fs from "node:fs/promises";
import path from "node:path";
import {
  applyTransactionLineItems,
  parseAccountDataHtml,
  parseLicensePages,
  parseTransactionDetailHtml,
  parseGamesPlayedHtml,
  parseSteamDate,
  extractSteamIdFromGamesHtml,
  type AccountDataParseResult,
  type AccountSpendRow,
  type LicenseCoverage,
  type LicenseRow,
  type LoginHistoryRow,
  type PlayedGame,
  type PurchaseHistoryRow,
  type PurchaseLineItem,
  type SourceParseStatus,
} from "@/lib/account-data";
import {
  licensePageFiles,
  licenseWalkWasInterrupted,
} from "@/lib/account-data/pagination";
import { ensurePrivateDir } from "@/lib/process/private-files";
import { rootPath } from "@/lib/runtime";

// Resolved per call (not at module load) so STEAM_STATS_ROOT can be set late.
const parsedPath = (file: string) => rootPath("samples", "parsed", file);
const rawPath = (file: string) => rootPath("samples", "account-data", file);

export type AccountSourceId =
  | "purchases"
  | "licenses"
  | "accountSpend"
  | "loginHistory";

export type AccountSourceState = {
  /**
   * - `ok`              rows are the whole data set
   * - `partial`         rows are only the first page (e.g. licences 1-100 of 453)
   * - `login-required`  the last fetch saved a Steam Help login page instead of
   *                     the data: the owner has to re-run the fetch and enter
   *                     the password. `rows` may still hold an older scrape.
   * - `unrecognized`    the saved page is not one the parser knows
   * - `unknown`         rows exist but the parsed file predates status
   *                     tracking, so nothing says whether they are complete:
   *                     re-run `npm run parse:account-data`
   * - `missing`         never fetched
   */
  status: SourceParseStatus | "unknown" | "missing";
  /** Rows available to the dashboard for this source. */
  rows: number;
  /** Human-readable reason / pagination note, when there is one. */
  detail?: string;
  /**
   * Licences only: how much of the list the saved pages cover, in Steam's
   * licence records. `recordsCovered < recordsTotal` means pages are missing.
   * `rows` is NOT comparable to `recordsTotal`: a page of 100 records renders
   * fewer table rows.
   */
  coverage?: LicenseCoverage;
};

/** The one error the UI shows verbatim (first-run hint). A constant: no paths. */
export const NO_ACCOUNT_DATA_PREFIX = "No Account Data found";
export const NO_ACCOUNT_DATA_MESSAGE = `${NO_ACCOUNT_DATA_PREFIX}. Run: npm run fetch:account-data && npm run parse:account-data`;

/** What an `unknown` source needs. */
export const REPARSE_HINT =
  "parsed by an older version — run: npm run parse:account-data";

export type LocalAccountBundle = {
  purchases: PurchaseHistoryRow[];
  licenses: LicenseRow[];
  accountSpend: AccountSpendRow[];
  loginHistory: LoginHistoryRow[];
  playedGames: PlayedGame[];
  playedFetchedAt: string | null;
  /**
   * `source` of games-played.json ("steam-session-api", "account-data-html",
   * "merged"). Always set by the loader; optional only for hand-built bundles.
   */
  playedSource?: string | null;
  /**
   * When the account-spend page was fetched (ISO), from the fetcher's meta
   * file. Valve's totals are as of then. Null when unknown.
   */
  accountSpendFetchedAt?: string | null;
  steamId: string | null;
  source: "parsed-json" | "raw-html";
  /**
   * Why each source has the rows it has. An empty `accountSpend` with
   * `status: "login-required"` is not "no spend" — it was never read.
   * Always set by the loader; optional only for hand-built bundles.
   */
  sourceStatus?: Record<AccountSourceId, AccountSourceState>;
};

type ParsedSourceFile<Row> = {
  kind?: string;
  status?: string;
  reason?: string;
  rows?: Row[];
  pagination?: { from: number; to: number; total: number; nextHref: string | null };
  coverage?: LicenseCoverage;
};

const STATUSES = new Set<string>([
  "ok",
  "partial",
  "login-required",
  "unrecognized",
]);

/** Status of one parsed source; also understands files written before `status` existed. */
export function sourceStateOf(
  file: ParsedSourceFile<unknown> | null | undefined,
): AccountSourceState {
  if (!file) return { status: "missing", rows: 0 };
  const rows = Array.isArray(file.rows) ? file.rows.length : 0;
  let status: AccountSourceState["status"];
  if (file.status && STATUSES.has(file.status)) {
    status = file.status as SourceParseStatus;
  } else if (file.kind === "unknown") {
    status = /login page/i.test(file.reason ?? "")
      ? "login-required"
      : "unrecognized";
  } else {
    // No recorded status: nothing says these rows are the whole data set.
    status = "unknown";
  }
  const p = file.pagination;
  const detail =
    status === "unknown"
      ? REPARSE_HINT
      : status === "partial" && p?.total
        ? `showing ${p.from}-${p.to} of ${p.total}`
        : file.reason;
  // Files parsed before `coverage` existed only have the last page's range.
  const coverage: LicenseCoverage | undefined =
    file.coverage ??
    (p?.total
      ? { pagesSaved: 1, recordsCovered: p.to, recordsTotal: p.total }
      : undefined);
  return {
    status,
    rows,
    ...(detail ? { detail } : {}),
    ...(coverage ? { coverage } : {}),
  };
}

async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Fill a missing `lastPlayedAt` from the label. A year-less label ("14 Jul")
 * is resolved against the snapshot's fetch time, never the wall clock, so the
 * same file gives the same dates whenever it is loaded.
 */
export function hydratePlayedGames(
  games: PlayedGame[],
  fetchedAt: string | null,
): PlayedGame[] {
  return games.map((g) => ({
    ...g,
    lastPlayedAt:
      g.lastPlayedAt && g.lastPlayedAt > 0
        ? g.lastPlayedAt
        : (parseSteamDate(g.lastPlayedText, { now: fetchedAt })?.getTime() ??
          null),
  }));
}

/** When the raw page was saved, from the fetcher's `<id>.meta.json`. */
async function rawSavedAt(id: string): Promise<string | null> {
  const meta = await readJsonIfExists<{ savedAt?: string }>(
    rawPath(`${id}.meta.json`),
  );
  return meta?.savedAt ?? null;
}

async function loadPlayedGames(): Promise<{
  games: PlayedGame[];
  steamId: string | null;
  fetchedAt: string | null;
  source: string | null;
}> {
  const parsed = await readJsonIfExists<{
    games: PlayedGame[];
    steamId?: string;
    fetchedAt?: string;
    source?: string;
  }>(parsedPath("games-played.json"));
  if (parsed?.games?.length) {
    const fetchedAt = parsed.fetchedAt ?? null;
    return {
      games: hydratePlayedGames(parsed.games, fetchedAt),
      steamId: parsed.steamId ?? null,
      fetchedAt,
      source: parsed.source ?? null,
    };
  }

  try {
    const html = await fs.readFile(rawPath("games-all.html"), "utf8");
    // `fetchedAt` stays null (the dashboard reads that as "HTML, not the API");
    // the page's own save time still anchors its year-less labels.
    const savedAt = await rawSavedAt("games-all");
    return {
      games: parseGamesPlayedHtml(html, savedAt),
      steamId: extractSteamIdFromGamesHtml(html),
      fetchedAt: null,
      source: "account-data-html",
    };
  } catch {
    return { games: [], steamId: null, fetchedAt: null, source: null };
  }
}

/**
 * Per-item prices from the saved HelpWithTransaction pages
 * (`samples/account-data/transactions/<transid>.html`), keyed by transaction
 * id. Empty when the directory does not exist. Used by the raw-HTML loader and
 * by scripts/parse-account-data.ts, so both paths attach the same line items.
 */
export async function readTransactionLineItems(
  dir = rawPath("transactions"),
): Promise<Record<string, PurchaseLineItem[]>> {
  const out: Record<string, PurchaseLineItem[]> = {};
  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch {
    return out;
  }
  for (const file of files.sort()) {
    const id = file.match(/^(\d+)\.html$/)?.[1];
    if (!id) continue;
    const lines = parseTransactionDetailHtml(
      await fs.readFile(path.join(dir, file), "utf8"),
    );
    if (lines.length) out[id] = lines;
  }
  return out;
}

async function loadFromParsed(): Promise<LocalAccountBundle | null> {
  const purchaseFile = await readJsonIfExists<
    ParsedSourceFile<PurchaseHistoryRow>
  >(parsedPath("purchase-history.json"));
  if (
    !purchaseFile ||
    purchaseFile.kind !== "purchase-history" ||
    !Array.isArray(purchaseFile.rows)
  ) {
    return null;
  }

  const licensesFile = await readJsonIfExists<ParsedSourceFile<LicenseRow>>(
    parsedPath("licenses.json"),
  );
  const spendFile = await readJsonIfExists<ParsedSourceFile<AccountSpendRow>>(
    parsedPath("account-spend.json"),
  );
  const loginFile = await readJsonIfExists<ParsedSourceFile<LoginHistoryRow>>(
    parsedPath("login-history.json"),
  );
  const played = await loadPlayedGames();

  return {
    purchases: purchaseFile.rows,
    licenses: licensesFile?.rows ?? [],
    accountSpend: spendFile?.rows ?? [],
    loginHistory: loginFile?.rows ?? [],
    playedGames: played.games,
    playedFetchedAt: played.fetchedAt,
    playedSource: played.source,
    accountSpendFetchedAt: await rawSavedAt("account-spend"),
    steamId: played.steamId,
    source: "parsed-json",
    sourceStatus: {
      purchases: sourceStateOf(purchaseFile),
      licenses: sourceStateOf(licensesFile),
      accountSpend: sourceStateOf(spendFile),
      loginHistory: sourceStateOf(loginFile),
    },
  };
}

const INTERRUPTED_WALK =
  "the last fetch was interrupted before every licence page was saved — re-run: npm run fetch:account-data";

/**
 * The licences list is paginated: licenses.html, licenses-2.html, … are pages
 * of one list and are joined in page order, as the parse script does.
 */
async function parseLicenseFiles(): Promise<{
  rows: LicenseRow[];
  state: AccountSourceState;
}> {
  let files: string[];
  try {
    files = licensePageFiles(await fs.readdir(rawPath("")));
  } catch {
    files = [];
  }
  if (!files.includes("licenses.html")) {
    return { rows: [], state: { status: "missing", rows: 0 } };
  }
  const pages = await Promise.all(
    files.map((f) => fs.readFile(rawPath(f), "utf8")),
  );
  const first = parseAccountDataHtml(pages[0], "licenses.html");
  if (first.kind !== "licenses") {
    const state = sourceStateOf(
      first.kind === "unknown"
        ? first
        : { kind: "unknown", reason: `expected licenses, got ${first.kind}` },
    );
    return { rows: [], state: { ...state, rows: 0 } };
  }
  const result = parseLicensePages(pages);
  const state = sourceStateOf(result);
  // After an interrupted walk the folder holds fresh pages 1..k plus older
  // later pages, which parse as a whole list on their own.
  const manifest = await readJsonIfExists<unknown>(rawPath("_manifest.json"));
  if (licenseWalkWasInterrupted(manifest)) {
    return {
      rows: result.rows,
      state: { ...state, status: "partial", detail: INTERRUPTED_WALK },
    };
  }
  return { rows: result.rows, state };
}

async function loadFromRawHtml(): Promise<LocalAccountBundle | null> {
  const map: Record<string, string> = {
    purchases: "purchase-history.html",
    accountSpend: "account-spend.html",
    loginHistory: "login-history.html",
  };

  try {
    const purchasesHtml = await fs.readFile(
      rawPath(map.purchases),
      "utf8",
    );
    const purchases = parseAccountDataHtml(purchasesHtml, map.purchases);
    if (purchases.kind !== "purchase-history") return null;

    // Only the purchase history is required; any other page may be absent.
    async function parseKind(
      file: string,
      kind: Exclude<AccountDataParseResult["kind"], "unknown">,
    ): Promise<{ rows: unknown[]; state: AccountSourceState }> {
      let html: string;
      try {
        html = await fs.readFile(rawPath(file), "utf8");
      } catch {
        return { rows: [], state: { status: "missing", rows: 0 } };
      }
      const result = parseAccountDataHtml(html, file);
      if (result.kind !== kind) {
        const state = sourceStateOf(
          result.kind === "unknown"
            ? result
            : { kind: "unknown", reason: `expected ${kind}, got ${result.kind}` },
        );
        return { rows: [], state: { ...state, rows: 0 } };
      }
      return { rows: result.rows, state: sourceStateOf(result) };
    }

    const played = await loadPlayedGames();
    const licenses = await parseLicenseFiles();
    const accountSpend = await parseKind(map.accountSpend, "account-spend");
    const loginHistory = await parseKind(map.loginHistory, "login-history");

    return {
      // Same as the parse script: real per-item prices from the transaction
      // detail pages, where they were fetched.
      purchases: applyTransactionLineItems(
        purchases.rows,
        await readTransactionLineItems(),
      ),
      licenses: licenses.rows as LicenseRow[],
      accountSpend: accountSpend.rows as AccountSpendRow[],
      loginHistory: loginHistory.rows as LoginHistoryRow[],
      playedGames: played.games,
      playedFetchedAt: played.fetchedAt,
      playedSource: played.source,
      accountSpendFetchedAt: await rawSavedAt("account-spend"),
      steamId: played.steamId,
      source: "raw-html",
      sourceStatus: {
        purchases: sourceStateOf(purchases),
        licenses: licenses.state,
        accountSpend: accountSpend.state,
        loginHistory: loginHistory.state,
      },
    };
  } catch {
    return null;
  }
}

export async function loadLocalAccountData(): Promise<LocalAccountBundle> {
  const fromParsed = await loadFromParsed();
  if (fromParsed) return fromParsed;
  const fromRaw = await loadFromRawHtml();
  if (fromRaw) return fromRaw;
  throw new Error(NO_ACCOUNT_DATA_MESSAGE);
}

/** data/ holds caches of the owner's library, spend and gifts: owner-only (0700). */
export async function ensureDataDir() {
  const dir = rootPath("data");
  await ensurePrivateDir(dir);
  return dir;
}

export function dataPath(...parts: string[]) {
  return rootPath("data", ...parts);
}
