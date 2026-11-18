import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Test data roots: generated copy and committed fixtures.
    ".test-root/**",
    "tests/fixtures/**",
    // Local agent tooling and Playwright output — never shipped, gitignored.
    ".claude/**",
    "test-results/**",
    "playwright-report/**",
  ]),
  // Runtime seam: server code reaches the network and the data root only
  // through src/lib/runtime.ts, so STEAM_STATS_OFFLINE / STEAM_STATS_ROOT hold.
  {
    files: ["src/lib/**/*.{ts,tsx}", "src/app/api/**/*.{ts,tsx}"],
    ignores: ["src/lib/runtime.ts", "src/lib/process/spawn-script.ts"],
    rules: {
      "no-restricted-globals": [
        "error",
        {
          name: "fetch",
          message: "Use netFetch from @/lib/runtime so offline mode holds.",
        },
      ],
      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "cwd",
          message: "Use rootPath()/appRoot() from @/lib/runtime.",
        },
      ],
    },
  },
]);

export default eslintConfig;
