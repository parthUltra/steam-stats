/**
 * Conditions the dashboard must tell the owner about instead of failing:
 * a cache file that exists but cannot be read. The file is never overwritten;
 * the dashboard renders from an empty in-memory stand-in.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { CorruptJsonFileError } from "@/lib/data/json-store";
import { appRoot } from "@/lib/runtime";

export type DataIssueCode =
  | "price-cache-unreadable"
  | "received-gifts-unreadable";

export type DataIssue = {
  code: DataIssueCode;
  /** The unreadable file, relative to the data root (never an absolute path). */
  file: string;
  /** Its last good copy, relative to the data root; null when none exists. */
  backup: string | null;
  /** One sentence for the owner. */
  message: string;
};

const LABEL: Record<DataIssueCode, string> = {
  "price-cache-unreadable": "price cache unreadable",
  "received-gifts-unreadable": "received gifts file unreadable",
};

/** Describe a corrupt file for the client: relative paths only. */
export async function corruptFileIssue(
  code: DataIssueCode,
  err: CorruptJsonFileError,
): Promise<DataIssue> {
  const rel = (p: string) => path.relative(appRoot(), p);
  const hasBackup = await fs
    .access(err.backupPath)
    .then(() => true)
    .catch(() => false);
  const file = rel(err.filePath);
  const backup = hasBackup ? rel(err.backupPath) : null;
  return {
    code,
    file,
    backup,
    message: backup
      ? `${LABEL[code]} — a backup exists at ${backup}. ${file} was left untouched.`
      : `${LABEL[code]} — no backup exists. ${file} was left untouched.`,
  };
}

/**
 * Run a cache loader. A corrupt file yields `fallback` plus an issue pushed
 * onto `issues`; any other error is rethrown.
 */
export async function loadOrReport<T>(
  code: DataIssueCode,
  load: () => Promise<T>,
  fallback: () => T,
  issues: DataIssue[],
): Promise<T> {
  try {
    return await load();
  } catch (err) {
    if (!(err instanceof CorruptJsonFileError)) throw err;
    issues.push(await corruptFileIssue(code, err));
    return fallback();
  }
}
