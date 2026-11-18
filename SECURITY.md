# Security policy

Steam Stats runs on your own machine and stores a signed-in Steam session and your purchase history. Reports that affect either are taken seriously.

## Supported versions

There are no tagged releases yet. Fixes land on `main`, and `main` is the only supported version.

| Version | Supported |
|---------|-----------|
| `main` (latest commit) | Yes |
| Older commits and forks | No |

## Reporting a vulnerability

Report privately through GitHub security advisories:

<https://github.com/parthUltra/steam-stats/security/advisories/new>

Do not open a public issue for a vulnerability, and do not include your own Account Data, session files, cookies or API keys in a report. Reproduce against the synthetic fixture instead:

```bash
node tests/prepare-root.mjs
STEAM_STATS_ROOT=.test-root STEAM_STATS_OFFLINE=1 npm run dev
```

A useful report says what an attacker needs (network position, a page the user visits, a file they control), the request or steps, and what they gain.

This is a personal project maintained in spare time. Expect an acknowledgement within a week. You will be credited in the changelog unless you ask otherwise.

## Threat model in brief

The app is built to answer only the person running it.

Defended:

- **Other devices on the network.** The server binds to `127.0.0.1`, and every route rejects a `Host` other than `localhost`, `127.0.0.1` or `[::1]`.
- **Websites open in the same browser.** DNS rebinding fails the host check. `POST` and `DELETE` require a same-origin `Origin` or `Sec-Fetch-Site`. A Content Security Policy restricts scripts, connections and framing.
- **Hostile input.** The IsThereAnyDeal key is validated and stored in one owner-only file. The artwork proxy fetches only Steam CDN image paths, refuses redirects and SVG, and caps size. The server can start only two fixed scripts with an allow-listed environment.
- **Leaks in responses.** No key, cookie, gift link or process id is returned. Errors carry fixed messages.
- **Other users on the machine.** Credential and data files are `0600`, directories `0700`.

Not defended:

- Anything running as your own user account. The dashboard has no login.
- Copies of `.steam-session/` or `.gmail-session/` made by backups or sync tools. These are bearer credentials.
- Deployments the app is not designed for: another bind address, a reverse proxy, a hosted server.

Details are in [docs/security.md](docs/security.md).

## Scope

In scope:

- Reading Account Data, session files or keys from another origin, another device, or another local user.
- Triggering a write, a fetch or a child process from another origin.
- Bypassing the host allow-list or the origin guard.
- Server-side request forgery through `/api/steam-art` or any other route.
- Script injection through scraped Steam or Gmail content.
- Secrets or personal data appearing in API responses, logs, or the git history of this repository.

Out of scope:

- Attacks that need code execution or file access as the user running the app.
- Problems that appear only after changing the bind address, the host allow-list, or the security headers.
- Vulnerabilities in Steam, IsThereAnyDeal or Gmail.
- Dependency advisories with no reachable path in this app. Still worth an ordinary issue.
