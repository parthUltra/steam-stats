import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  detectAccountDataKind,
  isSteamHelpLoginHtml,
  parseAccountDataHtml,
  parseLoginHistory,
} from "./parsers";

describe("isSteamHelpLoginHtml", () => {
  it("detects Steam Help password walls", () => {
    const html = `
      <title>Steam Help</title>
      <link href="https://help.steampowered.com/en/login/?redir=%2Fen%2Faccountdata%2FSteamLoginHistory&amp;need_password=1">
      <input type="password" />
    `;
    assert.equal(isSteamHelpLoginHtml(html), true);
    const parsed = parseAccountDataHtml(html, "login-history.html");
    assert.equal(parsed.kind, "unknown");
    assert.match(parsed.reason, /login page/i);
  });
});

describe("detectAccountDataKind", () => {
  it("reads login history without thead using the filename hint", () => {
    const html = `
      <table class="AccountDataTable">
        <tr>
          <th>Anmeldezeit</th><th>Abmeldezeit</th><th>OS</th>
          <th>Land</th><th>Stadt</th><th>Region</th>
        </tr>
        <tr>
          <td>1 Jan 2026</td><td>2 Jan 2026</td><td>Windows</td>
          <td>DE</td><td>Berlin</td><td>BE</td>
        </tr>
      </table>
    `;
    assert.equal(detectAccountDataKind(html, "login-history.html"), "login-history");
    const rows = parseLoginHistory(html);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.osType, "Windows");
  });

  it("does not treat a login wall as login-history even with a file hint", () => {
    const html = `
      <title>Steam Help</title>
      <link href="https://help.steampowered.com/login/?redir=%2Fen%2Faccountdata%2FAccountSpend&need_password=1">
    `;
    assert.equal(detectAccountDataKind(html, "account-spend.html"), "unknown");
  });
});
