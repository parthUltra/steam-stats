import fs from "node:fs/promises";
import { dataPath } from "@/lib/data/load-local";
import {
  ensurePrivateDir,
  writePrivateFile,
} from "@/lib/process/private-files";
import { rootPath } from "@/lib/runtime";

const FILE = "itad-credentials.json";

/**
 * An ITAD API key is a short opaque token. Anything else — whitespace, a
 * newline, `=`, `$` — is rejected, so a key can never smuggle extra content
 * into whatever stores or forwards it.
 */
const ITAD_KEY_SHAPE = /^[A-Za-z0-9_-]{16,128}$/;

export function isValidItadApiKey(value: unknown): value is string {
  return typeof value === "string" && ITAD_KEY_SHAPE.test(value);
}

/**
 * Looser check for a key that is already on disk or in the environment (set by
 * the owner before validation existed): printable ASCII, no whitespace.
 */
const STORED_KEY_SHAPE = /^[\x21-\x7e]{8,256}$/;

function isUsableStoredKey(value: unknown): value is string {
  return typeof value === "string" && STORED_KEY_SHAPE.test(value);
}

export class InvalidItadKeyError extends Error {}

export type ItadCredentials = {
  apiKey: string;
  appName?: string;
  updatedAt: string;
};

export async function loadItadCredentials(): Promise<ItadCredentials | null> {
  try {
    const raw = await fs.readFile(dataPath(FILE), "utf8");
    const parsed = JSON.parse(raw) as ItadCredentials;
    if (!isUsableStoredKey(parsed?.apiKey)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Persist the key in data/itad-credentials.json (owner-only) and nowhere else.
 * It is deliberately NOT written to .env.local: that file is parsed into the
 * environment of every process the app starts.
 */
export async function saveItadCredentials(
  apiKey: string,
  appName = "steam-stats",
): Promise<ItadCredentials> {
  if (!isValidItadApiKey(apiKey)) {
    throw new InvalidItadKeyError("Invalid IsThereAnyDeal API key");
  }
  await ensurePrivateDir(rootPath("data"));
  const row: ItadCredentials = {
    apiKey,
    appName,
    updatedAt: new Date().toISOString(),
  };
  await writePrivateFile(dataPath(FILE), JSON.stringify(row, null, 2));
  return row;
}

/**
 * The key saved through the app wins; an environment variable
 * (ISTHEREANYDEAL_API_KEY / ITAD_API_KEY, e.g. from an existing .env.local) is
 * still honoured as a fallback. A malformed value from either source is ignored.
 */
export async function resolveItadApiKey(): Promise<string | null> {
  const stored = await loadItadCredentials();
  if (stored) return stored.apiKey;
  for (const name of ["ISTHEREANYDEAL_API_KEY", "ITAD_API_KEY"] as const) {
    const value = process.env[name]?.trim();
    if (isUsableStoredKey(value)) return value;
  }
  return null;
}
