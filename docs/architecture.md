# Architecture

Steam Stats is a Next.js 16 App Router application with a handful of command-line scripts. The scripts fetch and cache; the server reads local files and computes; the browser renders. This page follows the data from Steam to the screen and maps each stage to its code.

## Data flow

```
 fetch                parse                price                  compute               render
 ─────                ─────                ─────                  ───────               ──────
 Playwright browser   cheerio parsers      Steam store + ITAD     pure functions        React client
 scripts/fetch-*.ts   scripts/parse-*.ts   scripts/refresh-*.ts   src/lib/analytics     src/components
        │                    │                    │               src/lib/stats               ▲
        ▼                    ▼                    ▼                      ▲                    │
 samples/account-data ─▶ samples/parsed     data/price-cache.json ───────┤                    │
 .steam-session                             data/artwork-cache.json      │                    │
                                            data/dlc-parents.json   buildDashboard() ─▶ DashboardPayload
                                            data/gifts-received.json
```

The rule that shapes everything: **loading the dashboard never touches the network and never writes a file.** Fetching and pricing happen in scripts, either run by you or started by the server as a detached background process.

### 1. Fetch

`scripts/fetch-account-data.ts` opens a visible Chromium window through Playwright. You sign in on Steam's own page; the script waits for the `steamLoginSecure` cookie, saves the session to `.steam-session/storage-state.json`, and then saves each Account Data page as HTML under `samples/account-data/` with a `.meta.json` beside it. Two pages need extra work, implemented as pure functions in `src/lib/account-data/pagination.ts` so they can be tested without a browser:

- The license list is server-paginated. The script follows the "next" link and saves `licenses.html`, `licenses-2.html`, and so on. Leftover pages from an older, longer fetch are removed only after a complete walk.
- Purchase history loads more rows behind a button. The script clicks until the page's cursor is gone, then marks the saved HTML as complete.

It finishes by fetching the full library with playtime from the Steam Web API, using the access token inside the session cookie (`src/lib/steam/owned-games.ts`). Family-library playtime is merged in when available. `scripts/fetch-owned-games.ts` repeats only this last step.

`scripts/fetch-transactions.ts` fetches Steam's per-transaction help pages so a multi-item checkout can be split into the real per-game amounts.

### 2. Parse

`scripts/parse-account-data.ts` runs the parsers in `src/lib/account-data/parsers.ts` and `games-playtime.ts` over the saved HTML and writes `samples/parsed/*.json`. Each source records a status that the UI later shows as a data note:

| Status | Meaning |
|--------|---------|
| `ok` | Parsed in full |
| `partial` | Only some pages or rows were saved |
| `login-required` | Steam returned a login page instead of the data |
| `unrecognized` | The saved page is not one the parser knows |
| `missing` | Never fetched |

`src/lib/data/load-local.ts` reads the parsed JSON and the saved pages into one `LocalAccountBundle`. An integration test checks that the raw-HTML path and the parsed-JSON path produce the same rows.

### 3. Price

`scripts/refresh-prices.ts` builds the list of titles to price (library plus received gifts), detects the store region from spend currency and login history (`src/lib/pricing/store-region.ts`), and calls `refreshPricesForTitles` in `src/lib/pricing/prices.ts`:

- Current price and app id come from the Steam store API for the detected country.
- All-time lows on the Steam store come from IsThereAnyDeal, in bulk, only when a key is present.
- Requests are paced, and a 429 from IsThereAnyDeal is raised as a rate-limit error instead of being retried in a loop.

Results go to `data/price-cache.json`, valid for 7 days. The script then fills `data/dlc-parents.json` and `data/artwork-cache.json`, which the dashboard only ever reads.

The browser asks `GET /api/refresh-prices` for status on load. If the cache is stale it sends a `POST`, and the server starts the same script as a detached child (`src/lib/process/spawn-script.ts`), tracking it through `.price-refresh/status.json`.

Gift sync (`src/lib/gifts/`) works the same way: a detached script drives a separate browser window with an isolated profile, parses Steam gift emails, and merges them into `data/gifts-received.json`.

### 4. Compute

`src/lib/analytics/dashboard.ts` has two halves:

- `loadDashboardInputs()` reads files. No network, no writes. A corrupt cache becomes an empty stand-in plus a `dataIssue`.
- `computeDashboard(inputs)` is a pure function that returns the `DashboardPayload` declared in `src/lib/analytics/contracts.ts`.

Inside it:

| Module | Produces |
|--------|----------|
| `spending.ts` | Net spend, refunds, gifts sent, wallet top-ups, market, payment methods, per month and per year totals, discounts |
| `acquisition.ts` | How each title was obtained: purchased, bundle, gifted to me, free, ownership grant, unknown unpaid, gifted by me |
| `edition-packs.ts` | Folds editions and packs so one game is one shelf row, paid once |
| `valuation.ts` | Per-title paid, shelf now, lowest; the three totals; gifts received and sent |
| `cost-per-hour.ts` | Paid divided by hours (under one hour counts as one hour; under 30 minutes is "unplayed") |
| `src/lib/stats/*` | The twelve stats boards. Each is a pure function of `StatsInput` and returns `null` when the data cannot support it |

Time-based stats measure from the playtime snapshot time, not from the wall clock, so a build is deterministic.

### 5. Render

`src/app/page.tsx` calls `buildDashboard()` on the server for the first paint and hands the payload to `DashboardClient`, which owns refresh polling. `DashboardView` lays out the header, the two tabs and the Help drawer.

- `src/components/library/`: shelf grid, table, panorama, game detail drawer. `use-url-state.ts` keeps tab, sort, view, filters, search and the open game in the query string.
- `src/components/value/`: the summary bars, cost per hour table, spend timeline, gifts board, ledger detail, and the data notes that explain every gap.
- `src/components/stats/`: one component per board, plus shared chart parts.
- `src/components/ui/`: primitives.

## HTTP surface

| Route | Methods | Purpose |
|-------|---------|---------|
| `/` | GET | The dashboard |
| `/api/dashboard` | GET | The payload as JSON, from local files only |
| `/api/refresh-prices` | GET, POST | Refresh status; start a background price refresh |
| `/api/itad-key` | GET, POST | Whether a key is stored; save a key |
| `/api/gifts-received` | GET, POST, DELETE | Gift list and sync status; start Gmail sync; clear the list |
| `/api/steam-art` | GET | Same-origin proxy for Steam cover art, used by the panorama PNG export |

Every route passes the host allow-list in `src/proxy.ts`. Every `POST` and `DELETE` passes the origin guard. See [security.md](security.md).

## The runtime seam

`src/lib/runtime.ts` is the only module in `src/lib` and `src/app/api` allowed to call `process.cwd()` or bare `fetch`; ESLint enforces it. It exposes:

| Variable | Effect |
|----------|--------|
| `STEAM_STATS_ROOT` | Data root to use instead of the project folder. Holds `samples/`, `data/` and the session directories |
| `STEAM_STATS_OFFLINE=1` | Refuses every outbound request and child process |
| `STEAM_STATS_NO_PACING=1` | Tests only. Removes the delay between stubbed requests |

The tests rely on this seam: each gate points the root at a throwaway copy of the synthetic fixture and switches the network off. `src/instrumentation.ts` adds a server-side tripwire so a call that bypasses `netFetch` fails loudly when offline.

The fetch scripts (`fetch-account-data`, `fetch-transactions`) write to the project folder directly and do not honor `STEAM_STATS_ROOT`.

## Storage

`src/lib/data/json-store.ts` handles every cache file in `data/`: write to a temporary file, fsync, rename; read-modify-write under a lock file; mode `0600`. A missing file is distinct from a corrupt one. A corrupt file throws `CorruptJsonFileError` and is never written over. The price cache and the gifts file keep a `.bak` of the last good copy.

## Tests

| Location | Gate | Runner |
|----------|------|--------|
| `src/**/*.test.ts` | Unit | `node:test` through `tsx` |
| `tests/integration/` | Integration | `node:test`, with `tests/setup.ts` |
| `tests/security/` | Security | `node:test`, with `tests/setup.ts` |
| `tests/e2e/` | Browser | The runner bundled in `playwright`, against `next build && next start` on port 3210 |

`tests/fixtures/library-a/` is the synthetic account. `expected.json` holds totals worked out by hand from the fixture rows, never copied from application output; the fixture's README shows the arithmetic.
