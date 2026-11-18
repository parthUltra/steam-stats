import childProcess, { type ChildProcess } from "node:child_process";
import path from "node:path";
import { isOffline, OfflineError } from "@/lib/runtime";

/**
 * The only variables a child script receives. Everything else — in particular
 * NODE_OPTIONS and anything else that makes Node load code — is dropped, so a
 * poisoned environment cannot turn "start a refresh" into code execution.
 */
const CHILD_ENV_ALLOW = [
  // locating binaries, home and temp
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "TEMP",
  "TMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  // app configuration
  "NODE_ENV",
  "STEAM_STATS_ROOT",
  "STEAM_STATS_OFFLINE",
  "STEAM_STATS_DEBUG_SCRAPE",
  "STEAM_STATS_SKIP_PRICES",
  "ISTHEREANYDEAL_API_KEY",
  "ITAD_API_KEY",
  // outbound network: a corporate proxy / private CA must keep working in
  // the child. These only route or trust connections — unlike NODE_OPTIONS
  // they cannot make Node load code.
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "NO_PROXY",
  "https_proxy",
  "http_proxy",
  "no_proxy",
  "NODE_EXTRA_CA_CERTS",
  // headed browser (Gmail sync) on Linux
  "DISPLAY",
  "WAYLAND_DISPLAY",
  "XAUTHORITY",
  "XDG_RUNTIME_DIR",
  "DBUS_SESSION_BUS_ADDRESS",
  "PLAYWRIGHT_BROWSERS_PATH",
  // Windows essentials
  "SYSTEMROOT",
  "SystemRoot",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "ProgramFiles",
  "ProgramFiles(x86)",
] as const;

export function childEnv(
  source: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of CHILD_ENV_ALLOW) {
    const value = source[name];
    if (typeof value === "string") out[name] = value;
  }
  return out;
}

/** The only scripts the server may start. */
const SPAWNABLE = new Set([
  "scripts/refresh-prices.ts",
  "scripts/sync-gifts-gmail.ts",
]);

/** Detached Node+tsx child — PID is the node process, not a shell. */
export function spawnDetachedScript(scriptRel: string): ChildProcess {
  if (!SPAWNABLE.has(scriptRel)) {
    throw new Error("spawnDetachedScript: script is not on the allow-list");
  }
  if (isOffline()) throw new OfflineError(`offline: spawn ${scriptRel}`);
  // Code root (not the data root): the child gets STEAM_STATS_ROOT via env.
  const root = process.cwd();
  const tsxCli = path.join(
    /* turbopackIgnore: true */ root,
    "node_modules",
    "tsx",
    "dist",
    "cli.mjs",
  );
  const script = path.join(/* turbopackIgnore: true */ root, scriptRel);
  // Called through the module object so tests can observe it.
  const child = childProcess.spawn(process.execPath, [tsxCli, script], {
    cwd: root,
    detached: true,
    stdio: "ignore",
    shell: false,
    env: childEnv() as NodeJS.ProcessEnv,
  });
  child.unref();
  return child;
}
