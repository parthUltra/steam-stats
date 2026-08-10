import fs from "node:fs/promises";
import { dataPath, ensureDataDir } from "@/lib/data/load-local";

const FILE = "itad-credentials.json";

export type ItadCredentials = {
  apiKey: string;
  appName?: string;
  updatedAt: string;
};

export async function loadItadCredentials(): Promise<ItadCredentials | null> {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(dataPath(FILE), "utf8");
    const parsed = JSON.parse(raw) as ItadCredentials;
    if (!parsed?.apiKey || typeof parsed.apiKey !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveItadCredentials(
  apiKey: string,
  appName = "steam-stats",
): Promise<ItadCredentials> {
  await ensureDataDir();
  const row: ItadCredentials = {
    apiKey: apiKey.trim(),
    appName,
    updatedAt: new Date().toISOString(),
  };
  await fs.writeFile(dataPath(FILE), JSON.stringify(row, null, 2));
  await upsertEnvLocalKey(row.apiKey);
  return row;
}

/** Also write into .env.local so CLI tools pick it up after restart. */
async function upsertEnvLocalKey(apiKey: string) {
  const envPath = `${process.cwd()}/.env.local`;
  const line = `ISTHEREANYDEAL_API_KEY=${apiKey}`;
  let text = "";
  try {
    text = await fs.readFile(envPath, "utf8");
  } catch {
    text = "";
  }
  if (/^ISTHEREANYDEAL_API_KEY=/m.test(text)) {
    text = text.replace(/^ISTHEREANYDEAL_API_KEY=.*$/m, line);
  } else if (/^ITAD_API_KEY=/m.test(text)) {
    text = text.replace(/^ITAD_API_KEY=.*$/m, line);
  } else {
    text = `${text.trimEnd()}${text.trim() ? "\n" : ""}${line}\n`;
  }
  await fs.writeFile(envPath, text);
}

export async function resolveItadApiKey(): Promise<string | null> {
  const fromEnv =
    process.env.ISTHEREANYDEAL_API_KEY?.trim() ||
    process.env.ITAD_API_KEY?.trim() ||
    "";
  if (fromEnv) return fromEnv;
  const stored = await loadItadCredentials();
  return stored?.apiKey?.trim() || null;
}
