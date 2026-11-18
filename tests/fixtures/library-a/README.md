# library-a — synthetic Steam account

Everything here is invented: 45 titles with app ids 9000001–9000045 (plus DLC
9000101 and pack 9000201), two fictional friends, INR / India. No real account,
person, e-mail or app id appears. `tests/integration/guards.test.ts` enforces that.

| Path | What | How it is produced |
|---|---|---|
| `samples/account-data/*.html` | Steam-shaped Account Data pages | `tests/fixtures/build-library-a.ts` |
| `samples/parsed/*.json` | parsed rows | the **real** parsers, run on the HTML above by the same script |
| `data/*.json` | price, artwork, DLC and gift caches; canary ITAD key | same script |
| `.steam-session/storage-state.json` | canary session cookie | same script |
| `expected.json` | the correct totals | **by hand**, from the rows — never from application output |

Regenerate the first four with `npx tsx tests/fixtures/build-library-a.ts`.
The tests never use this folder directly: `tests/setup.ts` (and
`tests/prepare-root.mjs` for the browser gate) copy it to a throwaway root.

Artwork is inline SVG stored as `data:` URIs in `data/artwork-cache.json`, so
the page shows capsules with no network at all.

Canaries (must never appear in a response or a rendered page):
`CANARY-ITAD-KEY-000000000000`, `CANARY-STEAM-TOKEN`.

## How `expected.json` was derived

Snapshot time is 2026-10-15T12:00Z. Money is INR.

### Playtime
44 games are in the playtime snapshot; their minutes sum to 149,550 = **2,492.5 h**.
Three have 0 minutes (Brass Meridian, Wintering, Oddment Hotel) → **41 played**.
Last-two-weeks minutes: 420 + 150 + 300 + 240 + 96 + 180 = 1,386 = **23.1 h**.
Ironroot II was bought after the snapshot (licence and purchase, no playtime
row) → the library holds **45** games. DLC, packs and edition SKUs in the
licence list are not extra games.

### Spending (what you paid for your own library)
35 purchases. Per year:

| Year | Purchases | Sum |
|---|---|---|
| 2021 | 899 + 649 + 1,199 + 700 + 1,049 + 299 | 4,795 |
| 2022 | 480 + 349 + 1,499 + 199 + 399 + 249 | 3,175 |
| 2023 | 599 + 1,000 + 224 + 1,250 + 560 + **600** | 4,233 |
| 2024 | 549 + 324 + 199 + 900 + 1,299 + 810 + 374 | 4,455 |
| 2025 | 1,500 + 450 + **400** + 129 + 150 + 89 | 2,718 |
| 2026 | 715 + 449 + 275 + 1,800 | 3,239 |
| | | **22,615** |

- **600** (12 Dec 2023): a ₹1,000 cart of Lumen Drift ₹600 + Ashfall Protocol
  ₹400; only Ashfall Protocol was refunded. Net ₹600 spent, ₹400 refunded.
- **400** (14 Mar 2025): a ₹900 checkout of Cinder Vale ₹400 + a ₹500 Digital
  Gift Card. The game is library spend; the card is a gift.
- Refunded: Broken Compass ₹799 (whole purchase) + Ashfall Protocol ₹400 = **1,199**.
- Gifts: Glass Orchard ₹499 → pixel_otter; Moss Kingdom ₹450 + Tidebreaker
  ₹1,050 → nova_wren; Digital Gift Cards ₹500 + ₹2,000 (a Steam digital gift
  card is always sent to someone else) = **4,499**.
- Wallet top-ups: one ₹1,000 wallet credit = **1,000**.
- Market: one ₹120 purchase and one ₹45 **sale** (credit). Spend is 120; net
  of the sale 75. Either is accepted; 165 (credit added as spend) is wrong.
- Payment methods: Kestrel Run ₹1,500 was paid ₹200 from the wallet and ₹1,300
  by Visa. UPI 11,375 · Visa 8,291 · Mastercard 2,749 · Steam Wallet 200.
- On sale: 11 of 35 purchases (−40, −60, −50, −75, −60, −75, −75, −50, −75,
  −75, −90) → 31.43 %, average 65.91 % off, list minus paid = 10,008.

### Shelf (one row per game you own)
`valuation.apps` lists every owned, priced game once.

- Starfall Tactics includes its DLC Crimson Front: paid 899 + 299, now
  1,299 + 399, lowest 449 + 199.
- Voidrunner 2 was bought as "Voidrunner 2: Ultimate Edition" (₹560) and
  Saltwater Diner as "Saltwater Diner - Gourmet Edition" (₹324): one game, one
  row, paid once.
- Hollow Circuit (₹480) and Hollow Circuit: Overclock (₹900) are two games.
  So are Pyrewatch (₹399) and Pyrewatch Eternal (₹449, bought as "… Standard
  Edition"), and Ironroot (₹700) and Ironroot II (₹1,800).
- Lanternfall and Lanternfall Remnant came in the ₹810 Lanternfall Collection:
  the pack row carries the ₹810 and no shelf price; the two games carry shelf
  prices and paid 0.
- Rustline Rally is 100 % off in the store today. It is still a ₹599 purchase;
  with no positive store price its shelf-now falls back to the stored low (299).
- Free titles (Skyline Brawl, Driftwood Tales, Bramble Post, Oddment Hotel)
  count their store price for shelf-now and 0 for lowest.
- Gifts received: Marrow Deep (licence says Gift) and Pocket Cartographer
  (gift e-mail record) → now 1,499 + 349, lowest 599 + 104.
- Not on the shelf: Cobalt Siege (free weekend only) and Aurora Crossing
  (family library). Obsidian Tram is owned (₹275) but has no price quote.

Sum of the 42 priced rows: now **44,210**, lowest **16,766**. Sum of paid over
all rows (42 + Obsidian Tram 275 + the pack 810) = 22,615 = net spent.

### Cost per hour
paid ÷ max(hours, 1 h); under 30 minutes counts as unplayed. Ironroot II has no
playtime at all and must not borrow Ironroot's 120 h.
