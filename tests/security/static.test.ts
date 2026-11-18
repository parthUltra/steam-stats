import { REPO_ROOT } from "./helpers";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import nextConfig from "../../next.config";

async function headersFor(): Promise<Map<string, string>> {
  const rules = await nextConfig.headers!();
  const all = rules.find((r) => r.source === "/:path*");
  assert.ok(all, "security headers must apply to every path");
  return new Map(all.headers.map((h) => [h.key.toLowerCase(), h.value]));
}

function directives(csp: string): Map<string, string[]> {
  return new Map(
    csp.split(";").map((d) => {
      const [name, ...values] = d.trim().split(/\s+/);
      return [name, values] as [string, string[]];
    }),
  );
}

test("security headers are configured for every route", async () => {
  const h = await headersFor();
  assert.equal(nextConfig.poweredByHeader, false);
  assert.equal(h.get("x-content-type-options"), "nosniff");
  assert.equal(h.get("x-frame-options"), "DENY");
  assert.equal(h.get("referrer-policy"), "no-referrer");
  assert.equal(h.get("cross-origin-opener-policy"), "same-origin");
  assert.equal(h.get("cross-origin-resource-policy"), "same-origin");
  assert.ok(h.get("content-security-policy"));
});

test("CSP: same-origin by default, Steam CDN images only, no framing", async () => {
  const csp = directives((await headersFor()).get("content-security-policy")!);
  assert.deepEqual(csp.get("default-src"), ["'self'"]);
  assert.deepEqual(csp.get("frame-ancestors"), ["'none'"]);
  assert.deepEqual(csp.get("object-src"), ["'none'"]);
  assert.deepEqual(csp.get("base-uri"), ["'none'"]);
  assert.deepEqual(csp.get("form-action"), ["'self'"]);
  assert.deepEqual(csp.get("font-src"), ["'self'", "data:"]);

  assert.deepEqual(csp.get("img-src"), [
    "'self'",
    "data:",
    "blob:",
    "https://shared.akamai.steamstatic.com",
    "https://cdn.cloudflare.steamstatic.com",
    "https://steamcdn-a.akamaihd.net",
    "https://shared.fastly.steamstatic.com",
  ]);

  // Style attributes (charts, inline SVG) must stay allowed.
  assert.ok(csp.get("style-src")!.includes("'unsafe-inline'"));

  // Outside `next dev` there is no eval and no remote script or connect source.
  if (process.env.NODE_ENV !== "development") {
    assert.deepEqual(csp.get("script-src"), ["'self'", "'unsafe-inline'"]);
    assert.deepEqual(csp.get("connect-src"), ["'self'"]);
  }
  for (const [name, values] of csp) {
    if (name === "img-src") continue;
    for (const v of values) {
      assert.equal(/^https?:|^\*$/.test(v), false, `${name} allows ${v}`);
    }
  }
});

test("the image optimizer has no remote allow-list", () => {
  assert.equal(nextConfig.images?.remotePatterns, undefined);
  assert.equal(nextConfig.images?.domains, undefined);
});

test("the Host allow-list proxy exists and matches every route", () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, "src", "proxy.ts"), "utf8");
  assert.match(src, /export function proxy\(/);
  assert.equal(/export const config\b/.test(src), false, "no matcher: all paths");
});

test("server binds to loopback in every start path", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
  assert.match(pkg.scripts.dev, /-H 127\.0\.0\.1/);
  assert.match(pkg.scripts.start, /-H 127\.0\.0\.1/);
  const launch = fs.readFileSync(path.join(REPO_ROOT, "scripts", "launch.sh"), "utf8");
  for (const line of launch.split("\n")) {
    if (/\bnext (dev|start)\b/.test(line)) assert.match(line, /-H 127\.0\.0\.1/);
  }
});

test("the ITAD key handler never writes .env.local or process.env", () => {
  for (const rel of [
    "src/app/api/itad-key/route.ts",
    "src/lib/pricing/itad-credentials.ts",
  ]) {
    const src = fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
    assert.equal(/["'`]\.env/.test(src), false, `${rel} references an env file`);
    assert.equal(/process\.env\.[A-Z_]+\s*=[^=]/.test(src), false, `${rel} assigns process.env`);
  }
});

test("git tracks no personal data or secrets", () => {
  let files: string[];
  try {
    files = execFileSync("git", ["ls-files"], { cwd: REPO_ROOT, encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
  } catch {
    return; // not a git checkout
  }
  const bad = files.filter(
    (f) =>
      (/^(samples|data)\//.test(f) && !/^(samples|data)\/README\.md$/.test(f)) ||
      /^\.(steam|gmail|itad)-session\//.test(f) ||
      /^\.price-refresh\//.test(f) ||
      (/^\.env/.test(f) && f !== ".env.example"),
  );
  assert.deepEqual(bad, []);
});
