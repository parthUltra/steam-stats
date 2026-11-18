/**
 * Guards on what is committed: the fixture holds no personal data, and no real
 * Account Data or cache file is tracked by git.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { FIXTURE_STEAM_ID, listFiles, REPO } from "../helpers";

const FIXTURES = path.join(REPO, "tests", "fixtures");
const files = listFiles(FIXTURES).filter((f) => !/\.(png|jpg|jpeg|webp|woff2?)$/i.test(f));
const read = (f: string) => fs.readFileSync(f, "utf8");
const rel = (f: string) => path.relative(REPO, f);

describe("fixtures contain no personal data", () => {
  it("the only 17-digit Steam id is the canary (account 0)", () => {
    for (const f of files) {
      for (const id of read(f).match(/\b7656119\d{10}\b/g) ?? []) {
        assert.equal(id, FIXTURE_STEAM_ID, `${rel(f)} contains Steam id ${id}`);
      }
    }
  });

  it("no e-mail address outside example.com", () => {
    for (const f of files) {
      for (const mail of read(f).match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? []) {
        assert.match(mail, /@example\.com$/i, `${rel(f)} contains ${mail}`);
      }
    }
  });

  it("every app id is in the synthetic range (>= 9000001)", () => {
    const patterns = [
      /"(?:steamAppId|appId|appid)"\s*:\s*(\d+)/g,
      /\\"appid\\":(\d+)/g,
      /store\.steampowered\.com\/app\/(\d+)/g,
      /"parents"\s*:\s*\{([^}]*)\}/g,
    ];
    for (const f of files) {
      const text = read(f);
      for (const re of patterns) {
        for (const m of text.matchAll(re)) {
          for (const n of m[1].match(/\d+/g) ?? []) {
            assert.ok(Number(n) >= 9000001, `${rel(f)}: app id ${n} is not synthetic`);
          }
        }
      }
    }
  });

  it("no session token, API key or URL credential other than the canaries", () => {
    for (const f of files) {
      const text = read(f);
      assert.ok(!/eyJ[A-Za-z0-9_-]{20,}\./.test(text), `${rel(f)} contains a JWT-like token`);
      assert.ok(!/\b[0-9A-F]{32}\b/.test(text), `${rel(f)} contains a 32-hex key (Steam Web API key shape)`);
      for (const m of text.matchAll(/steamLoginSecure[^\n]*?"value"\s*:\s*"([^"]+)"/g)) {
        assert.match(m[1], /CANARY-STEAM-TOKEN$/, `${rel(f)} holds a non-canary session cookie`);
      }
    }
    const cookie = read(
      path.join(FIXTURES, "library-a", ".steam-session", "storage-state.json"),
    );
    assert.match(cookie, /CANARY-STEAM-TOKEN/);
    const key = JSON.parse(
      read(path.join(FIXTURES, "library-a", "data", "itad-credentials.json")),
    ) as { apiKey: string };
    assert.equal(key.apiKey, "CANARY-ITAD-KEY-000000000000");
  });

  it("artwork is local: every cached URL is a data: URI", () => {
    const cache = JSON.parse(
      read(path.join(FIXTURES, "library-a", "data", "artwork-cache.json")),
    ) as { byAppId: Record<string, { library: string; header: string; capsule: string }> };
    const entries = Object.entries(cache.byAppId);
    assert.ok(entries.length >= 45);
    for (const [id, a] of entries) {
      for (const url of [a.library, a.header, a.capsule]) {
        assert.ok(url.startsWith("data:image/svg+xml"), `app ${id}: ${url.slice(0, 50)}`);
      }
    }
  });
});

describe("git tracks no real account data", () => {
  let tracked: string[] | null = null;
  try {
    tracked = execFileSync("git", ["ls-files"], { cwd: REPO, encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
  } catch {
    tracked = null; // not a git checkout (e.g. a source tarball)
  }

  it("nothing under samples/ or data/ except the two READMEs", { skip: tracked == null }, () => {
    const bad = tracked!.filter(
      (f) =>
        (f.startsWith("samples/") || f.startsWith("data/")) &&
        f !== "samples/README.md" &&
        f !== "data/README.md",
    );
    assert.deepEqual(bad, []);
  });

  it("no env file, session folder, refresh state or test root is tracked", { skip: tracked == null }, () => {
    const bad = tracked!.filter(
      (f) =>
        (/^\.env/.test(f) && f !== ".env.example") ||
        /^\.(steam|gmail|itad)-session\//.test(f) ||
        f.startsWith(".price-refresh/") ||
        f.startsWith(".test-root/"),
    );
    assert.deepEqual(bad, []);
  });

  it("the working-tree data folders and session folders are ignored by git", { skip: tracked == null }, () => {
    for (const p of [
      "data/price-cache.json",
      "samples/parsed/purchase-history.json",
      ".steam-session/storage-state.json",
      ".gmail-session/status.json",
      ".env.local",
      ".test-root/data/price-cache.json",
    ]) {
      let ignored = true;
      try {
        execFileSync("git", ["check-ignore", "-q", p], { cwd: REPO });
      } catch {
        ignored = false;
      }
      assert.ok(ignored, `${p} is not gitignored`);
    }
    // …while the committed fixture is NOT ignored.
    for (const p of [
      "tests/fixtures/library-a/data/price-cache.json",
      "tests/fixtures/library-a/samples/parsed/purchase-history.json",
      "tests/fixtures/library-a/.steam-session/storage-state.json",
    ]) {
      let ignored = true;
      try {
        execFileSync("git", ["check-ignore", "-q", p], { cwd: REPO });
      } catch {
        ignored = false;
      }
      assert.ok(!ignored, `${p} is gitignored — the fixture would not be committed`);
    }
  });
});
