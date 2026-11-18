/**
 * Owner-only files and directories for credentials, session cookies and PII.
 * `mode` on writeFile/mkdir only applies at creation, so both helpers also
 * chmod, which tightens files that already exist. Contents are never read.
 */
import fs from "node:fs/promises";

export async function ensurePrivateDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.chmod(dir, 0o700).catch(() => undefined);
}

export async function writePrivateFile(
  file: string,
  data: string,
): Promise<void> {
  await fs.writeFile(file, data, { encoding: "utf8", mode: 0o600 });
  await fs.chmod(file, 0o600).catch(() => undefined);
}

/** Tighten a file some other tool wrote (e.g. Playwright storageState). */
export async function makePrivate(file: string): Promise<void> {
  await fs.chmod(file, 0o600).catch(() => undefined);
}
