/**
 * Summarizes saved Account Data HTML so we can design parsers.
 * Usage: npm run analyze:account-data
 */
import fs from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";

const SAMPLES_DIR = path.resolve(__dirname, "..", "samples", "account-data");

async function analyzeFile(filePath: string) {
  const html = await fs.readFile(filePath, "utf8");
  const $ = cheerio.load(html);
  const name = path.basename(filePath);

  const title = $("title").first().text().trim();
  const h1 = $("h1").first().text().trim();
  const tables = $("table")
    .toArray()
    .map((table, i) => {
      const $t = $(table);
      const headers = $t
        .find("thead th, tr:first-child th, tr:first-child td")
        .map((_, el) => $(el).text().replace(/\s+/g, " ").trim())
        .get()
        .filter(Boolean);
      const rowCount = $t.find("tr").length;
      return { index: i, headers: headers.slice(0, 12), rowCount };
    });

  const classes = new Set<string>();
  $("[class]")
    .slice(0, 200)
    .each((_, el) => {
      const cls = $(el).attr("class");
      if (cls) {
        for (const c of cls.split(/\s+/)) {
          if (
            /history|wallet|license|transaction|account|spend|purchase|row|table/i.test(
              c,
            )
          ) {
            classes.add(c);
          }
        }
      }
    });

  const textSample = $("body")
    .text()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);

  return {
    file: name,
    bytes: Buffer.byteLength(html, "utf8"),
    title,
    h1,
    tableCount: tables.length,
    tables: tables.slice(0, 8),
    interestingClasses: [...classes].slice(0, 40),
    textSample,
    looksLikeLogin:
      /sign in with your steam account/i.test(textSample) ||
      !!$("#login_btn_signin").length,
  };
}

async function main() {
  let files: string[];
  try {
    files = (await fs.readdir(SAMPLES_DIR)).filter((f) => f.endsWith(".html"));
  } catch {
    console.error(`No samples at ${SAMPLES_DIR}. Run: npm run fetch:account-data`);
    process.exit(1);
  }

  if (files.length === 0) {
    console.error("No HTML samples found. Run: npm run fetch:account-data");
    process.exit(1);
  }

  const reports = [];
  for (const file of files.sort()) {
    const report = await analyzeFile(path.join(SAMPLES_DIR, file));
    reports.push(report);
    console.log("\n===", report.file, "===");
    console.log("title:", report.title);
    console.log("h1:", report.h1);
    console.log("tables:", report.tableCount, report.tables);
    console.log("classes:", report.interestingClasses.join(", ") || "(none)");
    console.log("login-wall?:", report.looksLikeLogin);
    console.log("text:", report.textSample.slice(0, 200));
  }

  const out = path.join(SAMPLES_DIR, "_analysis.json");
  await fs.writeFile(out, JSON.stringify(reports, null, 2), "utf8");
  console.log(`\nWrote ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
