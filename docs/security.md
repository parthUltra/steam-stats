# Security model

Steam Stats holds two things worth protecting: a signed-in Steam session, and your purchase history. This page describes who the app is built to keep out, how, and where its protection ends. To report a problem, see [SECURITY.md](../SECURITY.md).

## What is at stake

| Asset | Where | Why it matters |
|-------|-------|----------------|
| Steam session cookies | `.steam-session/storage-state.json` | Whoever holds them is signed in to your Steam account |
| Gmail browser profile | `.gmail-session/browser-profile/` | A signed-in Gmail session (only present if you used gift sync) |
| IsThereAnyDeal API key | `data/itad-credentials.json`, or `.env.local` | Rate-limited key tied to your ITAD account |
| Account Data | `samples/` | Purchases, payment methods, login history, Steam ID |
| Gift records | `data/gifts-received.json` | Friends' persona names and gift redemption links |

## Who the app defends against

### A device on the same network

- `npm run dev`, `npm start` and `npm run launch` all pass `-H 127.0.0.1`, so the server listens on loopback only.
- `src/proxy.ts` checks the `Host` header on every route (pages, API and Next.js internals). Anything other than `localhost`, `127.0.0.1` or `[::1]` (any port) gets `403 Forbidden host`.

### A website open in your browser

A page on another origin can make your browser send requests to `127.0.0.1`. Three layers deal with that:

- **DNS rebinding.** A rebinding page reaches the server with its own hostname in `Host`, so the allow-list above rejects it.
- **Cross-site writes.** Every `POST` and `DELETE` handler calls `rejectCrossOrigin` (`src/lib/http/same-origin.ts`). A request passes only when `Host` is loopback, `Sec-Fetch-Site` (if sent) is `same-origin` or `none`, `Origin` (if sent) matches the same loopback host and port, and at least one of those two headers is present. A request with neither header is refused, which is why `curl` needs an explicit `Origin`.
- **Content injection and framing.** `next.config.ts` sets these headers on every route:

  | Header | Value |
  |--------|-------|
  | `Content-Security-Policy` | `default-src 'self'`; images from self, `data:`, `blob:` and four Steam CDN hosts; `connect-src 'self'`; `object-src 'none'`; `base-uri 'none'`; `form-action 'self'`; `frame-ancestors 'none'` |
  | `X-Frame-Options` | `DENY` |
  | `X-Content-Type-Options` | `nosniff` |
  | `Referrer-Policy` | `no-referrer` |
  | `Cross-Origin-Opener-Policy` | `same-origin` |
  | `Cross-Origin-Resource-Policy` | `same-origin` |
  | `Permissions-Policy` | camera, microphone, geolocation, payment and USB disabled |

  The policy is static. `script-src` and `style-src` include `'unsafe-inline'` because the Next.js App Router streams its payload in inline scripts and the charts use style attributes. `'unsafe-eval'` and the hot-reload websocket are allowed in development only. Fonts are bundled, so the browser loads nothing from a third party except Steam cover art.

### Hostile input

- **IsThereAnyDeal key.** Accepted only if it matches `^[A-Za-z0-9_-]{16,128}$`. It is written to `data/itad-credentials.json` and never to `.env.local` or `process.env`, so a pasted value cannot introduce environment variables.
- **Artwork proxy** (`/api/steam-art`). Fetches only `https` URLs on five Steam CDN hosts, on the default port, with no credentials, and only paths shaped like store artwork. The upstream URL is rebuilt from the validated parts. Redirects are refused, the response must be JPEG, PNG, WebP or GIF (SVG is rejected), bodies are capped at 8 MB, and the response is served with `Content-Security-Policy: default-src 'none'; sandbox`.
- **Child processes.** The server can start exactly two scripts (`scripts/refresh-prices.ts` and `scripts/sync-gifts-gmail.ts`), without a shell, with a fixed argument list and an allow-listed environment. `NODE_OPTIONS` and anything else that makes Node load code is dropped.
- **Scraped data.** Steam pages and gift emails are parsed as data. Nothing scraped reaches a command line, and the UI has no `dangerouslySetInnerHTML`.

### Leaks through the app's own output

- `GET /api/itad-key` returns whether a key exists, never the key.
- Gift redemption links and raw mail headers stay on disk; API responses carry display fields only.
- Process ids of background jobs are stripped from status responses.
- `500` responses carry a fixed message. The underlying error, which can contain file paths or upstream URLs, goes to the server log.
- Steam Web API requests can carry a session token in the URL, so those URLs are never logged and errors are redacted before printing.

### Another user on the same machine

Files that hold credentials or personal data are created with mode `0600`, and their directories with `0700` (`src/lib/process/private-files.ts`, `src/lib/data/json-store.ts`). `scripts/launch.sh` also tightens `.env.local`, `data/`, `samples/` and the session directories on every run, in case an older version created them world-readable.

### Data loss

Cache files are written to a temporary file and renamed, under a lock. A cache file that exists but cannot be parsed is never overwritten: the dashboard renders without it, shows a data note, and points at the `.bak` copy if one exists.

## What is out of scope

- **Your own user account.** Any program running as you can read the session files and call the server. The dashboard has no login. If your account on this machine is compromised, treat the Steam session as compromised: sign out of all devices from Steam's account page, then delete `.steam-session/`.
- **Backups and sync.** The app cannot stop a backup tool or cloud-sync folder from copying `.steam-session/` or `.gmail-session/`. Keep the project folder out of synced locations, or exclude those paths.
- **Native Windows file permissions.** The POSIX modes above do not apply.
- **Steam, IsThereAnyDeal and Gmail themselves.** The app talks to them over HTTPS and trusts their responses as data.
- **A changed deployment.** Binding to another interface, putting the app behind a reverse proxy, or editing the host allow-list removes the protections above. The app is not designed to be hosted.

## Outbound connections

| Destination | When | What is sent |
|-------------|------|--------------|
| `store.steampowered.com`, `help.steampowered.com`, `steamcommunity.com` | Fetch scripts, in the Playwright browser | Your Steam session, as in a normal browser |
| `api.steampowered.com` | Library fetch, artwork lookup | Session access token (library); app ids (artwork) |
| `store.steampowered.com/api` | Price refresh, DLC lookup | App ids or titles, country code |
| `api.isthereanydeal.com` | Price refresh, only with a key | Your key, Steam app ids, country code |
| Steam image CDNs | Rendering cover art | Image requests |
| `mail.google.com` | Gmail gift sync, in its own browser window | Your Gmail session, a search for Steam gift mail |

Loading the dashboard reads local files only. Price refresh runs in a separate background process. With `STEAM_STATS_OFFLINE=1` every outbound request and child process is refused before a socket is opened.

There is no telemetry and no analytics. `NEXT_TELEMETRY_DISABLED` is set in CI; to opt out of Next.js's own anonymous telemetry on your machine, run `npx next telemetry disable`.

## How this is tested

`npm run test:security` runs offline against the synthetic fixture and checks, among other things: the host allow-list on every kind of route, the accepted and rejected matrix of the origin guard on every mutating handler, key validation and storage mode, the artwork proxy's SSRF, type, size and redirect rules, that no response contains a planted canary secret, and that git tracks no personal data. The tests live in `tests/security/`.
