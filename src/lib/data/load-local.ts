import fs from "node:fs/promises";
import path from "node:path";
import {
  parseAccountDataHtml,
  parseGamesPlayedHtml,
  parseLastPlayedAt,
  extractSteamIdFromGamesHtml,
  type AccountDataParseResult,
  type AccountSpendRow,
  type LicenseRow,
  type LoginHistoryRow,
  type MachineAuthName,
  type PlayedGame,
  type PurchaseHistoryRow,
} from "@/lib/account-data";

const ROOT = process.cwd();
const PARSED_DIR = path.join(ROOT, "samples", "parsed");
const RAW_DIR = path.join(ROOT, "samples", "account-data");
const DATA_DIR = path.join(ROOT, "data");

export type LocalAccountBundle = {
  purchases: PurchaseHistoryRow[];
  licenses: LicenseRow[];
  accountSpend: AccountSpendRow[];
  loginHistory: LoginHistoryRow[];
  machineNames: MachineAuthName[];
  playedGames: PlayedGame[];
  steamId: string | null;
  source: "parsed-json" | "raw-html";
};

async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function hydratePlayedGames(games: PlayedGame[]): PlayedGame[] {
  return games.map((g) => ({
    ...g,
    lastPlayedAt:
      g.lastPlayedAt && g.lastPlayedAt > 0
        ? g.lastPlayedAt
        : parseLastPlayedAt(g.lastPlayedText),
  }));
}

async function loadPlayedGames(): Promise<{
  games: PlayedGame[];
  steamId: string | null;
}> {
  const parsed = await readJsonIfExists<{ games: PlayedGame[]; steamId?: string }>(
    path.join(PARSED_DIR, "games-played.json"),
  );
  if (parsed?.games?.length) {
    return {
      games: hydratePlayedGames(parsed.games),
      steamId: parsed.steamId ?? null,
    };
  }

  try {
    const html = await fs.readFile(path.join(RAW_DIR, "games-all.html"), "utf8");
    return {
      games: hydratePlayedGames(parseGamesPlayedHtml(html)),
      steamId: extractSteamIdFromGamesHtml(html),
    };
  } catch {
    return { games: [], steamId: null };
  }
}

async function loadFromParsed(): Promise<LocalAccountBundle | null> {
  const purchaseFile = await readJsonIfExists<{
    kind: string;
    rows: PurchaseHistoryRow[];
  }>(path.join(PARSED_DIR, "purchase-history.json"));
  if (!purchaseFile || purchaseFile.kind !== "purchase-history") return null;

  const licensesFile = await readJsonIfExists<{ rows: LicenseRow[] }>(
    path.join(PARSED_DIR, "licenses.json"),
  );
  const spendFile = await readJsonIfExists<{ rows: AccountSpendRow[] }>(
    path.join(PARSED_DIR, "account-spend.json"),
  );
  const loginFile = await readJsonIfExists<{ rows: LoginHistoryRow[] }>(
    path.join(PARSED_DIR, "login-history.json"),
  );
  const machineFile = await readJsonIfExists<{ rows: MachineAuthName[] }>(
    path.join(PARSED_DIR, "machine-auth-names.json"),
  );
  const played = await loadPlayedGames();

  return {
    purchases: purchaseFile.rows,
    licenses: licensesFile?.rows ?? [],
    accountSpend: spendFile?.rows ?? [],
    loginHistory: loginFile?.rows ?? [],
    machineNames: machineFile?.rows ?? [],
    playedGames: played.games,
    steamId: played.steamId,
    source: "parsed-json",
  };
}

async function loadFromRawHtml(): Promise<LocalAccountBundle | null> {
  const map: Record<string, string> = {
    purchases: "purchase-history.html",
    licenses: "licenses.html",
    accountSpend: "account-spend.html",
    loginHistory: "login-history.html",
    machineNames: "machine-auth-names.html",
  };

  try {
    const purchasesHtml = await fs.readFile(
      path.join(RAW_DIR, map.purchases),
      "utf8",
    );
    const purchases = parseAccountDataHtml(purchasesHtml);
    if (purchases.kind !== "purchase-history") return null;

    async function parseKind(
      file: string,
      kind: Exclude<AccountDataParseResult["kind"], "unknown">,
    ): Promise<unknown[]> {
      const html = await fs.readFile(path.join(RAW_DIR, file), "utf8");
      const result = parseAccountDataHtml(html);
      if (result.kind === "unknown" || result.kind !== kind) return [];
      return "rows" in result ? result.rows : [];
    }

    const played = await loadPlayedGames();

    return {
      purchases: purchases.rows,
      licenses: (await parseKind(map.licenses, "licenses")) as LicenseRow[],
      accountSpend: (await parseKind(
        map.accountSpend,
        "account-spend",
      )) as AccountSpendRow[],
      loginHistory: (await parseKind(
        map.loginHistory,
        "login-history",
      )) as LoginHistoryRow[],
      machineNames: (await parseKind(
        map.machineNames,
        "machine-auth-names",
      )) as MachineAuthName[],
      playedGames: played.games,
      steamId: played.steamId,
      source: "raw-html",
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
  throw new Error(
    "No Account Data found. Run: npm run fetch:account-data && npm run parse:account-data",
  );
}

export async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  return DATA_DIR;
}

export function dataPath(...parts: string[]) {
  return path.join(ROOT, "data", ...parts);
}
