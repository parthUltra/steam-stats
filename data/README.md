# Local caches

The app writes its caches and one credential here. Everything in this folder except this file is gitignored. Files are created owner-only (mode `0600`).

| File | Written by | Contents |
|------|-----------|----------|
| `price-cache.json` | `npm run refresh:prices`, or the background refresh the dashboard starts when prices are over a week old | Current Steam store price and all-time low per title, with the detected store country and currency |
| `price-cache.json.bak` | Same | Last good copy of the price cache |
| `artwork-cache.json` | Price refresh | Cover art URLs per app id |
| `dlc-parents.json` | Price refresh | Which app ids are DLC, and of which game |
| `gifts-received.json` | **Value → Sync from Gmail**, or `npm run sync:gifts-gmail` | Gift titles, sender persona names, dates and gift links from Steam gift emails |
| `gifts-received.json.bak` | Same | Last good copy of the gifts file |
| `itad-credentials.json` | **Value → Get store lows** | Your IsThereAnyDeal API key. Treat it as a secret |

Loading the dashboard only reads these files. It never writes them.

## Deleting and restoring

- The price, artwork and DLC caches are safe to delete. The next price refresh rebuilds them.
- Deleting `gifts-received.json` removes imported gifts until you sync from Gmail again.
- Deleting `itad-credentials.json` disconnects all-time lows until you paste a key again.
- If the dashboard reports that a cache file is unreadable, the file was left untouched. Restore the backup, for example `cp data/price-cache.json.bak data/price-cache.json`, or delete the file to start empty.

Never commit or share the contents of this folder.
