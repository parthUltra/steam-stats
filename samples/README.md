# Local Steam Account Data

The fetch and parse scripts write your own Steam data here. Everything in this folder except this file is gitignored. Files are created owner-only (mode `0600`).

| Path | Written by | Contents |
|------|-----------|----------|
| `account-data/*.html` | `npm run fetch:account-data` | Raw pages saved from Steam: purchase history, licenses (`licenses.html`, `licenses-2.html`, … one file per page), account spend, login history, games |
| `account-data/*.meta.json`, `account-data/_manifest.json` | Same | When each page was saved, its size and HTTP status |
| `account-data/transactions/*.html` | `npm run fetch:transactions` | Per-purchase detail pages, used for exact per-game amounts |
| `parsed/*.json` | `npm run parse:account-data` | The same data as rows the dashboard reads |
| `parsed/games-played.json` | `npm run fetch:account-data` and `npm run fetch:owned-games` | Your library with playtime, and your Steam ID |
| `parsed/transaction-line-items.json` | `npm run fetch:transactions` | Line items per transaction |

`npm run launch` runs the fetch, parse and library steps for you.

These files contain your purchase history, payment methods, login history and Steam ID. Never commit, publish or attach them to an issue. To report a bug, reproduce it with the synthetic fixture in `tests/fixtures/library-a` instead.

Deleting this folder's contents removes your data from the dashboard until you fetch again.
