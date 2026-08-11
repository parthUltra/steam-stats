/**
 * Launch a headed Chromium-family browser for automation (Gmail sync, etc.).
 *
 * CRITICAL SAFETY RULES:
 * - Never quit, kill, or restart the user’s running browser.
 * - Never attach to an ambient CDP port on a browser we didn’t start.
 * - Never open the user’s real profile (profile locks + data-loss risk).
 * - Always use an isolated user-data-dir; close only that instance when done.
 */
import { chromium, type Browser, type Page } from "playwright";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";

const execFileAsync = promisify(execFile);

export type BrowserKind =
  | "chrome"
  | "edge"
  | "brave"
  | "arc"
  | "chromium"
  | "opera"
  | "vivaldi"
  | "dia"
  | "playwright";

export type BrowserTarget = {
  kind: BrowserKind;
  /** Short label for UI/status ("Chrome", "Edge", …) */
  label: string;
  executablePath: string | null;
  userDataDir: string | null;
  /** macOS app name (display only — never used to quit) */
  macAppName?: string;
  processNames: string[];
  /** Playwright channel when executablePath is null */
  channel?: "chrome" | "msedge" | "chromium";
};

function home(...parts: string[]) {
  return path.join(os.homedir(), ...parts);
}

function darwinBrowsers(): BrowserTarget[] {
  const apps = "/Applications";
  return [
    {
      kind: "chrome",
      label: "Chrome",
      executablePath: `${apps}/Google Chrome.app/Contents/MacOS/Google Chrome`,
      userDataDir: home("Library/Application Support/Google/Chrome"),
      macAppName: "Google Chrome",
      processNames: ["Google Chrome"],
      channel: "chrome",
    },
    {
      kind: "edge",
      label: "Edge",
      executablePath: `${apps}/Microsoft Edge.app/Contents/MacOS/Microsoft Edge`,
      userDataDir: home("Library/Application Support/Microsoft Edge"),
      macAppName: "Microsoft Edge",
      processNames: ["Microsoft Edge"],
      channel: "msedge",
    },
    {
      kind: "brave",
      label: "Brave",
      executablePath: `${apps}/Brave Browser.app/Contents/MacOS/Brave Browser`,
      userDataDir: home("Library/Application Support/BraveSoftware/Brave-Browser"),
      macAppName: "Brave Browser",
      processNames: ["Brave Browser"],
    },
    {
      kind: "arc",
      label: "Arc",
      executablePath: `${apps}/Arc.app/Contents/MacOS/Arc`,
      userDataDir: home("Library/Application Support/Arc/User Data"),
      macAppName: "Arc",
      processNames: ["Arc"],
    },
    {
      kind: "dia",
      label: "Dia",
      executablePath: `${apps}/Dia.app/Contents/MacOS/Dia`,
      userDataDir: home("Library/Application Support/Dia/User Data"),
      macAppName: "Dia",
      processNames: ["Dia"],
    },
    {
      kind: "opera",
      label: "Opera",
      executablePath: `${apps}/Opera.app/Contents/MacOS/Opera`,
      userDataDir: home("Library/Application Support/com.operasoftware.Opera"),
      macAppName: "Opera",
      processNames: ["Opera"],
    },
    {
      kind: "vivaldi",
      label: "Vivaldi",
      executablePath: `${apps}/Vivaldi.app/Contents/MacOS/Vivaldi`,
      userDataDir: home("Library/Application Support/Vivaldi"),
      macAppName: "Vivaldi",
      processNames: ["Vivaldi"],
    },
    {
      kind: "chromium",
      label: "Chromium",
      executablePath: `${apps}/Chromium.app/Contents/MacOS/Chromium`,
      userDataDir: home("Library/Application Support/Chromium"),
      macAppName: "Chromium",
      processNames: ["Chromium"],
      channel: "chromium",
    },
  ];
}

function winBrowsers(): BrowserTarget[] {
  const local = process.env.LOCALAPPDATA || home("AppData/Local");
  const pf = process.env["PROGRAMFILES"] || "C:\\Program Files";
  const pf86 = process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
  return [
    {
      kind: "chrome",
      label: "Chrome",
      executablePath: path.join(local, "Google/Chrome/Application/chrome.exe"),
      userDataDir: path.join(local, "Google/Chrome/User Data"),
      processNames: ["chrome.exe"],
      channel: "chrome",
    },
    {
      kind: "edge",
      label: "Edge",
      executablePath: path.join(pf, "Microsoft/Edge/Application/msedge.exe"),
      userDataDir: path.join(local, "Microsoft/Edge/User Data"),
      processNames: ["msedge.exe"],
      channel: "msedge",
    },
    {
      kind: "brave",
      label: "Brave",
      executablePath: path.join(
        pf,
        "BraveSoftware/Brave-Browser/Application/brave.exe",
      ),
      userDataDir: path.join(local, "BraveSoftware/Brave-Browser/User Data"),
      processNames: ["brave.exe"],
    },
    {
      kind: "opera",
      label: "Opera",
      executablePath: path.join(pf, "Opera/opera.exe"),
      userDataDir: path.join(local, "Opera Software/Opera Stable"),
      processNames: ["opera.exe"],
    },
    {
      kind: "vivaldi",
      label: "Vivaldi",
      executablePath: path.join(pf86, "Vivaldi/Application/vivaldi.exe"),
      userDataDir: path.join(local, "Vivaldi/User Data"),
      processNames: ["vivaldi.exe"],
    },
  ];
}

function linuxBrowsers(): BrowserTarget[] {
  return [
    {
      kind: "chrome",
      label: "Chrome",
      executablePath: "/usr/bin/google-chrome",
      userDataDir: home(".config/google-chrome"),
      processNames: ["google-chrome", "chrome"],
      channel: "chrome",
    },
    {
      kind: "chromium",
      label: "Chromium",
      executablePath: "/usr/bin/chromium-browser",
      userDataDir: home(".config/chromium"),
      processNames: ["chromium", "chromium-browser"],
      channel: "chromium",
    },
    {
      kind: "brave",
      label: "Brave",
      executablePath: "/usr/bin/brave-browser",
      userDataDir: home(".config/BraveSoftware/Brave-Browser"),
      processNames: ["brave", "brave-browser"],
    },
    {
      kind: "edge",
      label: "Edge",
      executablePath: "/usr/bin/microsoft-edge",
      userDataDir: home(".config/microsoft-edge"),
      processNames: ["microsoft-edge", "msedge"],
      channel: "msedge",
    },
  ];
}

function candidateBrowsers(): BrowserTarget[] {
  if (process.platform === "darwin") return darwinBrowsers();
  if (process.platform === "win32") return winBrowsers();
  return linuxBrowsers();
}

function isInstalled(target: BrowserTarget): boolean {
  if (target.executablePath && existsSync(target.executablePath)) return true;
  return false;
}

/** Map macOS LSHandler bundle id → browser kind */
function kindFromBundleId(bundleId: string): BrowserKind | null {
  const id = bundleId.toLowerCase();
  if (id.includes("google.chrome")) return "chrome";
  if (id.includes("microsoft.edgemac") || id.includes("microsoft.edge"))
    return "edge";
  if (id.includes("brave")) return "brave";
  if (id.includes("browsercompany.arc") || id.endsWith(".arc")) return "arc";
  if (id.includes("chromium")) return "chromium";
  if (id.includes("opera")) return "opera";
  if (id.includes("vivaldi")) return "vivaldi";
  if (id.includes("dia")) return "dia";
  if (id.includes("safari") || id.includes("firefox")) return null;
  return null;
}

async function defaultHttpsBrowserKind(): Promise<BrowserKind | null> {
  if (process.platform === "darwin") {
    try {
      const { stdout } = await execFileAsync("defaults", [
        "read",
        "com.apple.LaunchServices/com.apple.launchservices.secure",
        "LSHandlers",
      ]);
      const blocks = stdout.split(/\{|\}/);
      for (const block of blocks) {
        if (!/LSHandlerURLScheme\s*=\s*https\b/i.test(block)) continue;
        const m = block.match(/LSHandlerRoleAll\s*=\s*"?([^";\s]+)"?/);
        if (m?.[1]) return kindFromBundleId(m[1]);
      }
    } catch {
      // ignore
    }
    try {
      const plist = home(
        "Library/Preferences/com.apple.LaunchServices/com.apple.launchservices.secure.plist",
      );
      const { stdout } = await execFileAsync("plutil", [
        "-convert",
        "json",
        "-o",
        "-",
        plist,
      ]);
      const data = JSON.parse(stdout) as {
        LSHandlers?: Array<{
          LSHandlerURLScheme?: string;
          LSHandlerRoleAll?: string;
        }>;
      };
      for (const h of data.LSHandlers ?? []) {
        if (h.LSHandlerURLScheme === "https" && h.LSHandlerRoleAll) {
          return kindFromBundleId(h.LSHandlerRoleAll);
        }
      }
    } catch {
      // ignore
    }
  }

  if (process.platform === "win32") {
    try {
      const { stdout } = await execFileAsync("reg", [
        "query",
        "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice",
        "/v",
        "ProgId",
      ]);
      const m = stdout.match(/ProgId\s+REG_SZ\s+(\S+)/i);
      if (m?.[1]) {
        const prog = m[1].toLowerCase();
        if (prog.includes("chrome")) return "chrome";
        if (prog.includes("edge")) return "edge";
        if (prog.includes("brave")) return "brave";
        if (prog.includes("opera")) return "opera";
        if (prog.includes("vivaldi")) return "vivaldi";
        if (prog.includes("firefox")) return null;
      }
    } catch {
      // ignore
    }
  }

  if (process.platform === "linux") {
    try {
      const { stdout } = await execFileAsync("xdg-settings", [
        "get",
        "default-web-browser",
      ]);
      const desk = stdout.trim().toLowerCase();
      if (desk.includes("chrome")) return "chrome";
      if (desk.includes("chromium")) return "chromium";
      if (desk.includes("brave")) return "brave";
      if (desk.includes("edge")) return "edge";
      if (desk.includes("firefox")) return null;
    } catch {
      // ignore
    }
  }

  return null;
}

export async function resolveUserBrowser(): Promise<BrowserTarget> {
  const candidates = candidateBrowsers().filter(isInstalled);
  const preferred = await defaultHttpsBrowserKind();

  if (preferred) {
    const match = candidates.find((c) => c.kind === preferred);
    if (match) return match;
  }

  if (candidates[0]) return candidates[0];

  return {
    kind: "playwright",
    label: "Chromium",
    executablePath: null,
    userDataDir: null,
    processNames: [],
    channel: "chromium",
  };
}

export type ConnectUserBrowserOptions = {
  /** Status updates for UI / session files */
  onStatus?: (message: string) => void | Promise<void>;
  /** @deprecated use onStatus */
  onReopen?: (message: string) => void | Promise<void>;
  startUrl?: string;
  /**
   * Isolated profile directory for this automation window.
   * Required for safety — never reuse the user’s real browser profile.
   */
  isolatedUserDataDir: string;
};

export type ConnectedUserBrowser = {
  browser: Browser;
  page: Page;
  target: BrowserTarget;
  /** True when we own this process — safe to close when sync finishes */
  ownsBrowser: true;
};

async function emitStatus(
  opts: ConnectUserBrowserOptions | undefined,
  message: string,
) {
  await (opts?.onStatus ?? opts?.onReopen)?.(message);
}

/**
 * Open a dedicated automation browser window.
 * Leaves any already-open Chrome / Edge / etc. completely untouched.
 */
export async function connectUserBrowser(
  opts: ConnectUserBrowserOptions,
): Promise<ConnectedUserBrowser> {
  if (!opts.isolatedUserDataDir?.trim()) {
    throw new Error(
      "Gmail sync requires an isolated browser profile — refusing to touch your open browser.",
    );
  }

  const target = await resolveUserBrowser();
  const startUrl = opts.startUrl ?? "about:blank";
  await fs.mkdir(opts.isolatedUserDataDir, { recursive: true });

  await emitStatus(
    opts,
    `Opening a separate ${target.label} window for Gmail (your other browser windows stay open)…`,
  );

  const launchArgs = [
    "--disable-blink-features=AutomationControlled",
    "--no-first-run",
    "--no-default-browser-check",
  ];

  const context = await chromium.launchPersistentContext(
    opts.isolatedUserDataDir,
    {
      headless: false,
      args: launchArgs,
      ignoreDefaultArgs: ["--enable-automation"],
      viewport: null,
      ...(target.executablePath
        ? { executablePath: target.executablePath }
        : { channel: target.channel ?? "chromium" }),
    },
  );

  const page = context.pages()[0] ?? (await context.newPage());
  if (startUrl !== "about:blank") {
    await page.goto(startUrl, {
      waitUntil: "domcontentloaded",
      timeout: 120_000,
    });
  }

  return {
    browser: context as unknown as Browser,
    page,
    target,
    ownsBrowser: true,
  };
}

