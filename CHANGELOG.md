# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The project has no tagged releases yet; `package.json` is at 0.1.0.

## [Unreleased]

A rebuild of the dashboard, the analytics behind it, and the way the server is exposed. If you used an earlier commit, run `npm install` and then `npm run launch` once: it re-fetches your Account Data with the new pagination handling and tightens file permissions on existing data.

### Added

- Library tab: card grid, sortable list and panorama views; search; filters for played, unplayed, family library and past two weeks; a game detail drawer with playtime and money facts for one title.
- Tab, sort, view, filters, search text and the open game are stored in the URL, so back, forward and bookmarks work.
- Keyboard shortcuts for tabs, search, sort and view, with a switch in the Help drawer to turn single-key shortcuts off.
- Help drawer with a glossary of every term used on the page.
- Six Library stats boards: playtime concentration, playtime distribution, dormancy, backlog, hours by source, and library growth.
- Six Value stats, folded into the Value boards: the value map (paid against hours), paid vs all-time low, running spend total, purchase cohorts by year, discount depth, and a year-by-month purchase grid.
- Data notes on the Value tab that state what is missing and what it affects: unpriced titles, lows not connected, a partly fetched license list, a source that needs a re-login, an unreadable cache file.
- Per-source fetch status (`ok`, `partial`, `login-required`, `unrecognized`, `missing`) for purchase history, the license list and the account spend page.
- The fetch script follows license-list pagination and loads the whole purchase history instead of stopping at the first page.
- `STEAM_STATS_ROOT` to run against another data folder, and `STEAM_STATS_OFFLINE=1` to block all outbound requests and child processes.
- A synthetic fixture account (`tests/fixtures/library-a`) with expected totals derived by hand.
- Four test gates (unit, integration, security, browser), `npm run verify`, and a CI workflow that runs them on every push and pull request.
- `CONTRIBUTING.md`, `SECURITY.md`, issue and pull request templates, and `docs/` with the architecture and the security model.

### Changed

- Loading the dashboard reads local files only. It no longer contacts Steam or any price source and no longer writes any file; price refresh runs as a separate background process.
- The background price refresh starts only when the cache is missing or older than a week, instead of on every page load.
- Requires Node.js 22 or newer.
- The dashboard URL opened by `npm run launch` is `http://127.0.0.1:3000`.
- The IsThereAnyDeal key pasted in the app is stored only in `data/itad-credentials.json`. It is no longer written to `.env.local`. An `ISTHEREANYDEAL_API_KEY` already in the environment is still read as a fallback.
- All-time lows come from IsThereAnyDeal for your detected Steam store region. CheapShark is no longer used as a price source.
- Cache files are written atomically under a lock, and the price cache and gifts file keep a `.bak` of the last good copy.
- The Value tab is organized as a summary (paid, shelf now, lowest), cost per hour, spend over time, gifts, and ledger detail.
- Next.js updated to 16.4.6.

### Fixed

- An edition or pack purchase is no longer counted twice when the base game is also on the shelf; one game is one row, paid once.
- Standalone games whose names start with another game's name are no longer folded into that game as if they were DLC, and no longer borrow its hours for cost per hour.
- Owned games are no longer dropped from the shelf when the license list is incomplete.
- A partially refunded purchase keeps the part that was not refunded.
- A checkout that mixes a game with a digital gift card keeps the game as library spend.
- Digital gift cards count as gifts, not wallet top-ups.
- A purchase paid partly from the wallet and partly by card is split between the two payment methods instead of being credited entirely to the wallet.
- Community Market sales are no longer added to market spend.
- A gift purchase without transaction detail still appears under gifts sent.
- A partial or failed read of the price cache can no longer cause it to be overwritten with an empty one.

### Security

- The server binds to `127.0.0.1` in `dev`, `start` and `launch`. It previously listened on all interfaces.
- Every route rejects requests whose `Host` is not `localhost`, `127.0.0.1` or `[::1]`, which blocks LAN clients and DNS rebinding.
- `POST` and `DELETE` routes require a same-origin `Origin` or `Sec-Fetch-Site` header. Requests with neither are refused.
- The IsThereAnyDeal key is validated against a strict pattern before it is stored. This closes an injection path where a crafted key could add variables to `.env.local`.
- Added a Content Security Policy and related headers (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`, `Permissions-Policy`); removed the `X-Powered-By` header.
- The artwork proxy accepts only Steam CDN artwork paths over HTTPS, refuses redirects and SVG, caps responses at 8 MB, and returns `502` rather than `500` on upstream failure.
- Session, credential and data files are created owner-only (`0600` files, `0700` directories), and `launch` tightens files created by earlier versions.
- Background scripts receive an allow-listed environment; the server can start only the price refresh and gift sync scripts.
- API responses no longer include gift redemption links, process ids or underlying error messages. Credentials are redacted from log lines.
- The Next.js image optimizer has no remote allow-list.

[Unreleased]: https://github.com/parthUltra/steam-stats/commits/main
