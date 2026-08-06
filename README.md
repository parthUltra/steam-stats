# Steam Stats

Personal Steam analytics dashboard — **library playtime**, **spend vs shelf value**, and a **playtime panorama** collage. Runs locally with your own Account Data; nothing is uploaded to a third-party server.

![Next.js](https://img.shields.io/badge/Next.js-16-black) ![TypeScript](https://img.shields.io/badge/TypeScript-5-blue) ![License](https://img.shields.io/badge/license-MIT-green)

## Features

**Library**
- Hours / Recent / A–Z shelf views with search
- Playtime panorama (30m+ titles, sized by hours, downloadable PNG)
- Most-played hero + Steam Family Library titles when available

**Value**
- What you paid vs current / historical-low shelf value
- Cost per hour, unplayed spend, gifts, monthly habits
- Market quote refresh (Steam store + CheapShark)

## Requirements

- **Node.js 20+** (recommended)
- **npm** (or compatible package manager)
- A **Steam account** (you log in once in a local browser window)
- Optional: [Steam Web API key](https://steamcommunity.com/dev/apikey) for richer library APIs

## Installation

```bash
git clone https://github.com/parthUltra/steam-stats.git
cd steam-stats
npm install

# Playwright Chromium (used for Steam login + Account Data fetch)
npx playwright install chromium

cp .env.example .env.local
# Optional: add STEAM_API_KEY=... in .env.local
```

## Usage

### 1. Fetch your Steam Account Data (one-time / when you want a refresh)

```bash
npm run fetch:account-data
```

A Chromium window opens. Log into Steam (Steam Guard if prompted). The script saves HTML snapshots under `samples/account-data/` and a session under `.steam-session/` (both gitignored).

### 2. Parse snapshots into JSON

```bash
npm run parse:account-data
```

Writes fixtures to `samples/parsed/` (gitignored).

### 3. Pull full library playtime (recommended)

Uses the local Steam session from step 1:

```bash
npm run fetch:owned-games
```

### 4. (Optional) Enrich purchase line items & prices

```bash
npm run fetch:transactions   # per-item paid amounts from Steam transactions
npm run refresh:prices       # market quotes cache in data/
```

### 5. Run the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

| Script | Purpose |
|--------|---------|
| `npm run dev` | Next.js dev server |
| `npm run build` / `npm start` | Production build & serve |
| `npm run fetch:account-data` | Steam login + Account Data HTML |
| `npm run parse:account-data` | Parse HTML → JSON |
| `npm run fetch:owned-games` | Full library + family playtime |
| `npm run fetch:transactions` | Transaction line-item prices |
| `npm run refresh:prices` | Refresh `data/price-cache.json` |
| `npm run lint` | ESLint |

## Configuration

Copy `.env.example` → `.env.local`:

| Variable | Required | Description |
|----------|----------|-------------|
| `STEAM_API_KEY` | No | [Steam Web API key](https://steamcommunity.com/dev/apikey). Improves some library endpoints; session-based fetch already covers most playtime. |

## Privacy & security

- Runs **entirely on your machine**. Account HTML, session cookies, and caches stay local.
- **Never commit** `.env.local`, `.steam-session/`, `samples/`, or `data/` — they are gitignored.
- Session cookies in `.steam-session/` can access your Steam account. Treat them like passwords.
- Do not share screenshots that include purchase totals or Steam IDs if you care about privacy.

## Project layout

```
src/
  app/                 # Next.js App Router + API
  components/          # Dashboard UI (Library, Value, Panorama)
  components/ui/       # shadcn/ui primitives
  lib/
    account-data/      # Account Data HTML parsers
    analytics/         # Spending, valuation, cost/hr, dashboard
    pricing/           # Market quote cache
    steam/             # Owned games, artwork, DLC parents
scripts/               # CLI fetch / parse / refresh tools
samples/               # Local HTML + parsed JSON (gitignored)
data/                  # Local price / artwork caches (gitignored)
```

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Dashboard empty / parse errors | Re-run `fetch:account-data` then `parse:account-data` |
| Few games / missing hours | Run `fetch:owned-games` after a valid session |
| Login window times out | Complete Steam Guard within ~10 minutes; re-run fetch |
| Prices missing | `npm run refresh:prices` (first run can take a while) |
| Playwright missing browser | `npx playwright install chromium` |

## License

MIT — see [LICENSE](./LICENSE).
