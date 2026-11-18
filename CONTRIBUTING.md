# Contributing

Thanks for looking. This is a small personal project, so the process is short: keep changes focused, keep the gates green, and never put real account data in the repository.

## Set up

Requirements: Node.js 22 or newer and npm.

```bash
git clone https://github.com/parthUltra/steam-stats.git
cd steam-stats
npm install
npx playwright install chromium
```

You do not need a Steam account to work on the code. Run the app against the synthetic fixture:

```bash
node tests/prepare-root.mjs
STEAM_STATS_ROOT=.test-root STEAM_STATS_OFFLINE=1 npm run dev
```

Then open <http://127.0.0.1:3000>. The first command copies `tests/fixtures/library-a` to `.test-root` (gitignored), so anything the app writes lands in the copy.

## The gates

Run everything before you open a pull request:

```bash
npm run verify
```

That is typecheck, lint, and four test gates. CI runs the same steps.

| Step | Command | Notes |
|------|---------|-------|
| Typecheck | `npm run typecheck` | `tsc --noEmit` |
| Lint | `npm run lint` | Zero warnings allowed |
| Unit | `npm run test:unit` | `src/**/*.test.ts`, next to the code |
| Integration | `npm run test:integration` | Full payload against hand-derived totals |
| Security | `npm run test:security` | Host, origin, secrets, proxy, offline |
| Browser | `npm run test:e2e` | Production build in Chromium on port 3210 |

While iterating, run the one gate that covers your change. To run a single unit test file:

```bash
npx tsx --test src/lib/analytics/spending.test.ts
```

## Rules for tests and data

1. **Tests use only the synthetic fixture.** Never commit, paste or attach real Account Data, purchase history, session files, cookies, Steam IDs or API keys, in code, tests, issues or pull requests. `tests/integration/guards.test.ts` fails the build if the fixture contains a real-looking Steam ID, an email outside `example.com`, or an app id outside the synthetic range.
2. **Expected values are derived by hand.** `tests/fixtures/library-a/expected.json` is worked out from the fixture rows, with the arithmetic in the fixture's README. Do not copy numbers from application output into it. If your change alters a total, show the new arithmetic.
3. **Regenerate, do not hand-edit, the fixture files.** Change `tests/fixtures/build-library-a.ts` and run `npm run fixture:build`.
4. **A parser fix needs a test on synthetic HTML.** Write the smallest Steam-shaped snippet that reproduces the case.
5. **Tests stay offline.** Server code reaches the network only through `netFetch` and the data root only through `rootPath()` in `src/lib/runtime.ts`. ESLint rejects bare `fetch` and `process.cwd()` under `src/lib` and `src/app/api`.

## Next.js version

The project is on Next.js 16, whose conventions differ from earlier versions (for example, `src/proxy.ts` replaces `middleware.ts`). Check the guides shipped in `node_modules/next/dist/docs/` before using a framework API from memory.

## File layout

```
scripts/                 fetch, parse, price refresh, gift sync, launch
src/
  app/                   page, layout, styles, API routes
  proxy.ts               host allow-list for every route
  instrumentation.ts     offline tripwire
  components/
    library/             shelf grid, list, panorama, game detail, URL state
    value/               summary, cost per hour, spend timeline, gifts, data notes
    stats/               one component per stats board
    ui/                  primitives
  lib/
    account-data/        HTML parsers and pagination
    analytics/           spending, acquisition, valuation, cost per hour, dashboard
    stats/               one pure function per stats board
    pricing/             price cache, region detection, ITAD key storage
    steam/               library fetch, artwork, DLC parents
    gifts/               gift email parsing and Gmail sync
    data/                local loaders, crash-safe JSON store
    http/                host check, origin guard, error responses
    process/             child process spawn, private file modes
    runtime.ts           data root, offline switch, netFetch
tests/
  fixtures/library-a/    synthetic account and expected totals
  integration/           pipeline tests
  security/              security tests
  e2e/                   browser tests
docs/                    architecture, security model, screenshots
```

[docs/architecture.md](docs/architecture.md) follows the data through these folders.

### Where new code goes

- A new stat: a pure function in `src/lib/stats/` with a test beside it, added to `buildStats` in `src/lib/stats/index.ts`, and a component in `src/components/stats/`. Return `null` when the data cannot support the stat, and give the board a title that is the question it answers.
- A new field in the payload: declare it in `src/lib/analytics/contracts.ts`.
- A new mutating route: call `rejectCrossOrigin` first. `tests/security/origin-guard.test.ts` lists the mutating handlers and fails if one is missing.
- Anything that writes credentials or personal data: use `writePrivateFile` or the JSON store so the file is owner-only.

## Commits and pull requests

Commit messages follow the style already in the history: a lowercase type prefix, a colon, and a short summary of what changed for the user.

```
feat: auto-detect Steam store country for shelf pricing
fix: keep library recent play and unplayed titles accurate
chore: stop shipping Cursor and Impeccable tooling
```

Use `feat` for new behavior, `fix` for corrections, `chore` for tooling and housekeeping, and `docs` or `test` when the change is only that.

For a pull request:

- Keep it to one concern.
- Fill in the template, including the verify checklist.
- Add a line to `CHANGELOG.md` under "Unreleased" for anything a user would notice.
- Update `README.md` or `docs/` when you change a command, a file location, a limitation or the security model.
- Take screenshots from the fixture, never from your own library.

## Reporting bugs and security issues

Use the issue templates for bugs and feature requests. For anything security-sensitive, follow [SECURITY.md](SECURITY.md) and do not open a public issue.
