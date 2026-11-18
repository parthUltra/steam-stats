import path from "node:path";
import { defineConfig } from "playwright/test";

/**
 * Functional (browser) gate. Runs a production build on its own port against a
 * throwaway copy of the synthetic fixture (./.test-root, created by
 * tests/prepare-root.mjs) with the network switched off server-side.
 *
 * The runner is the one bundled in the `playwright` package — there is no
 * @playwright/test dependency.
 */
const PORT = 3210;
const HOST = "127.0.0.1";

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.ts",
  outputDir: "test-results",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["github"]] : [["list"]],
  timeout: 30_000,
  expect: { timeout: 7_000 },
  use: {
    baseURL: `http://${HOST}:${PORT}`,
    locale: "en-US",
    timezoneId: "UTC",
    colorScheme: "dark",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: `npx next build && npx next start -H ${HOST} -p ${PORT}`,
    url: `http://${HOST}:${PORT}`,
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      STEAM_STATS_ROOT: path.resolve(".test-root"),
      STEAM_STATS_OFFLINE: "1",
      // Empty strings win over .env.local, which `next start` would load.
      STEAM_API_KEY: "",
      ISTHEREANYDEAL_API_KEY: "",
      ITAD_API_KEY: "",
      TZ: "UTC",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
