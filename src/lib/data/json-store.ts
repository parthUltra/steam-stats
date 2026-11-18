/**
 * Crash-safe JSON files for data/ caches.
 *
 * - read:   "missing" (undefined) is distinct from "unreadable / corrupt" (throws).
 * - write:  temp file in the same directory → fsync → rename, so a reader never
 *           sees a half-written file and a killed writer leaves the old one intact.
 * - update: read-modify-write under a lock file, so two processes (the detached
 *           refresh script and the server) cannot overwrite each other's work.
 * - modes:  every file written here (data, .bak, temp, lock) is 0600, and a
 *           directory this module has to create is 0700. These caches hold the
 *           owner's library, spend and gift history.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

/** The file exists but cannot be read or parsed. Never write over it. */
export class CorruptJsonFileError extends Error {
  readonly code = "CORRUPT_JSON_FILE";
  readonly filePath: string;
  /** Last good copy, if a save with `backup: true` ever succeeded. */
  readonly backupPath: string;

  constructor(filePath: string, cause: unknown) {
    const why = cause instanceof Error ? cause.message : String(cause);
    super(
      `${filePath} is unreadable or corrupt (${why}). It was left untouched. ` +
        `Restore ${filePath}.bak over it, or delete it to start empty.`,
      { cause },
    );
    this.name = "CorruptJsonFileError";
    this.filePath = filePath;
    this.backupPath = `${filePath}.bak`;
  }
}

export class FileLockTimeoutError extends Error {
  constructor(lockPath: string, waitedMs: number) {
    super(`Timed out after ${waitedMs} ms waiting for ${lockPath}`);
    this.name = "FileLockTimeoutError";
  }
}

/** Owner read/write only. */
export const PRIVATE_FILE_MODE = 0o600;
/** Owner only. */
export const PRIVATE_DIR_MODE = 0o700;

/** Create (never chmod an existing) directory, owner-only. */
async function mkdirPrivate(dir: string) {
  await fs.mkdir(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
}

function errCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | null)?.code;
}

/** `undefined` only when the file does not exist; anything else unreadable throws. */
export async function readJsonFile<T>(filePath: string): Promise<T | undefined> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (err) {
    if (errCode(err) === "ENOENT") return undefined;
    throw new CorruptJsonFileError(filePath, err);
  }
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    throw new CorruptJsonFileError(filePath, err);
  }
}

async function writeFileSynced(filePath: string, data: string) {
  const fh = await fs.open(filePath, "w", PRIVATE_FILE_MODE);
  try {
    // `mode` above is filtered by the umask and ignored for an existing file.
    await fh.chmod(PRIVATE_FILE_MODE);
    await fh.writeFile(data, "utf8");
    await fh.sync();
  } finally {
    await fh.close();
  }
}

const tmpName = (filePath: string) =>
  `${filePath}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;

/**
 * Atomic replace. With `backup`, the file being replaced is first kept as
 * `<file>.bak` — but only if it still parses, so a corrupt file can never
 * push out the last good backup.
 *
 * The result is always mode 0600, whatever the replaced file's mode was: the
 * new file is a fresh inode created 0600 and renamed over the old one.
 */
export async function writeJsonAtomic(
  filePath: string,
  value: unknown,
  opts?: { backup?: boolean },
): Promise<void> {
  await mkdirPrivate(path.dirname(filePath));
  const tmp = tmpName(filePath);
  try {
    await writeFileSynced(tmp, JSON.stringify(value, null, 2));
    if (opts?.backup) {
      const previous = await fs.readFile(filePath, "utf8").catch(() => null);
      let good = false;
      if (previous != null) {
        try {
          JSON.parse(previous);
          good = true;
        } catch {
          // corrupt current file: keep the older .bak
        }
      }
      if (good && previous != null) {
        const bakTmp = tmpName(`${filePath}.bak`);
        await writeFileSynced(bakTmp, previous);
        await fs.rename(bakTmp, `${filePath}.bak`);
      }
    }
    await fs.rename(tmp, filePath);
  } catch (err) {
    await fs.unlink(tmp).catch(() => undefined);
    throw err;
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM = exists but not ours
    return errCode(err) === "EPERM";
  }
}

/**
 * Run `fn` while holding `<file>.lock` (created exclusively). A lock whose
 * owner pid is gone, or that is older than `staleMs`, is taken over. Holders
 * only keep it for one read-merge-write, so `staleMs` can stay small.
 */
export async function withFileLock<T>(
  filePath: string,
  fn: () => Promise<T>,
  opts?: { staleMs?: number; timeoutMs?: number },
): Promise<T> {
  const lockPath = `${filePath}.lock`;
  const staleMs = opts?.staleMs ?? 30_000;
  const timeoutMs = opts?.timeoutMs ?? 15_000;
  const started = Date.now();
  await mkdirPrivate(path.dirname(filePath));

  for (;;) {
    try {
      const fh = await fs.open(lockPath, "wx", PRIVATE_FILE_MODE);
      try {
        await fh.writeFile(JSON.stringify({ pid: process.pid, at: Date.now() }));
      } finally {
        await fh.close();
      }
      break;
    } catch (err) {
      if (errCode(err) !== "EEXIST") throw err;
    }

    let stale = false;
    try {
      const raw = await fs.readFile(lockPath, "utf8");
      const held = JSON.parse(raw) as { pid?: number; at?: number };
      stale =
        typeof held.pid !== "number" ||
        typeof held.at !== "number" ||
        !pidAlive(held.pid) ||
        Date.now() - held.at > staleMs;
    } catch (err) {
      // Gone already → just retry. Unparseable → mid-creation; judge by age.
      if (errCode(err) !== "ENOENT") {
        const st = await fs.stat(lockPath).catch(() => null);
        stale = st != null && Date.now() - st.mtimeMs > staleMs;
      }
    }
    if (stale) {
      await fs.unlink(lockPath).catch(() => undefined);
      continue;
    }
    if (Date.now() - started > timeoutMs) {
      throw new FileLockTimeoutError(lockPath, Date.now() - started);
    }
    await new Promise((r) => setTimeout(r, 15 + Math.random() * 25));
  }

  try {
    return await fn();
  } finally {
    await fs.unlink(lockPath).catch(() => undefined);
  }
}

/**
 * Locked read-modify-write. `update` gets the current on-disk value
 * (`undefined` if the file is missing) and returns what to store. If the file
 * is corrupt this throws before `update` runs and nothing is written.
 */
export async function updateJsonFile<T>(
  filePath: string,
  update: (current: T | undefined) => T | Promise<T>,
  opts?: { backup?: boolean },
): Promise<T> {
  return withFileLock(filePath, async () => {
    const current = await readJsonFile<T>(filePath);
    const next = await update(current);
    await writeJsonAtomic(filePath, next, opts);
    return next;
  });
}
