/**
 * Browser gate: copy the committed fixture into ./.test-root (gitignored), the
 * data root the test server is started with. Fresh on every run so a test that
 * writes (e.g. saving an ITAD key) can never touch the fixture or real data.
 */
import fs from "node:fs";
import path from "node:path";

const fixture = path.resolve("tests", "fixtures", "library-a");
const root = path.resolve(".test-root");

if (!fs.existsSync(path.join(fixture, "samples", "parsed", "purchase-history.json"))) {
  console.error(`Fixture missing at ${fixture}. Run: npx tsx tests/fixtures/build-library-a.ts`);
  process.exit(1);
}

fs.rmSync(root, { recursive: true, force: true });
fs.cpSync(fixture, root, { recursive: true });
console.log(`test root ready: ${root}`);
