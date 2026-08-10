# Local data caches

`itad-credentials.json` is written when you paste an IsThereAnyDeal API key
(**Value → Get India lows**). Price / artwork / DLC caches are written here at
runtime (`npm run refresh:prices`, dashboard sync).
`gifts-received.json` is filled by **Sync from Gmail** (Playwright browser login — same idea as Steam Account Data).

This folder is gitignored except for this placeholder. Safe to delete contents anytime — they regenerate.
