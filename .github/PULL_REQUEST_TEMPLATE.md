## What this changes

<!-- One or two sentences. What does a user or contributor notice? -->

## Why

<!-- The problem, or the issue this closes (Closes #123). -->

## How it was checked

- [ ] `npm run verify` passes locally (typecheck, lint, unit, integration, security, browser)
- [ ] New or changed behavior has a test
- [ ] Tests use only the synthetic fixture or small made-up inputs
- [ ] If a total in `tests/fixtures/library-a/expected.json` changed, the arithmetic is in the fixture README and was not copied from application output

## Data and security

- [ ] No real Account Data, purchase history, session files, cookies, Steam IDs or API keys in the diff, the description or the screenshots
- [ ] Screenshots, if any, were taken from the fixture (`STEAM_STATS_ROOT=.test-root`)
- [ ] Any new `POST` or `DELETE` route calls `rejectCrossOrigin`
- [ ] Any new outbound request goes through `netFetch`, and any new file with credentials or personal data is written owner-only

## Docs

- [ ] `CHANGELOG.md` has a line under "Unreleased" for user-visible changes
- [ ] `README.md` and `docs/` match any changed command, file location, limitation or security behavior
