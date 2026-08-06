#!/usr/bin/env bash
# One-shot: Steam login → fetch data → start dashboard → open browser
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

APP_URL="${STEAM_STATS_URL:-http://localhost:3000}"
SKIP_PRICES="${STEAM_STATS_SKIP_PRICES:-0}"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
info() { printf '→ %s\n' "$*"; }
ok() { printf '✓ %s\n' "$*"; }
die() { printf '✗ %s\n' "$*" >&2; exit 1; }

open_browser() {
  local url="$1"
  if command -v open >/dev/null 2>&1; then
    open "$url"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$url"
  elif command -v wslview >/dev/null 2>&1; then
    wslview "$url"
  else
    info "Open this URL in your browser: $url"
  fi
}

wait_for_http() {
  local url="$1"
  local tries="${2:-90}"
  local i=0
  while (( i < tries )); do
    if curl -sf -o /dev/null "$url"; then
      return 0
    fi
    sleep 1
    i=$((i + 1))
  done
  return 1
}

bold "Steam Stats — launch"
echo

# --- deps ---
if [[ ! -d node_modules ]]; then
  info "Installing npm dependencies…"
  npm install
  ok "Dependencies installed"
else
  ok "Dependencies present"
fi

# Ensure Playwright Chromium (no-op if already installed)
info "Checking Playwright Chromium…"
npx playwright install chromium
ok "Playwright Chromium ready"

if [[ ! -f .env.local && -f .env.example ]]; then
  cp .env.example .env.local
  info "Created .env.local from .env.example (optional STEAM_API_KEY)"
fi

echo
bold "Step 1/4 — Steam login & Account Data"
info "A browser window will open. Log into Steam (Steam Guard if asked)."
info "When login succeeds, Account Data pages are fetched automatically."
echo
npm run fetch:account-data

echo
bold "Step 2/4 — Parse Account Data"
npm run parse:account-data

echo
bold "Step 3/4 — Full library playtime"
npm run fetch:owned-games

if [[ "$SKIP_PRICES" != "1" ]]; then
  echo
  bold "Step 4/4 — Market prices (optional, can take a few minutes)"
  info "You can skip next time with STEAM_STATS_SKIP_PRICES=1"
  npm run refresh:prices || info "Price refresh had issues — you can retry from the Value tab."
else
  info "Skipping price refresh (STEAM_STATS_SKIP_PRICES=1)"
fi

echo
bold "Starting dashboard…"
info "Press Ctrl+C to stop the server."
echo

# Free port 3000 if a stale Next process is bound (best-effort)
if command -v lsof >/dev/null 2>&1; then
  if lsof -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1; then
    info "Port 3000 is in use — attempting to use the existing server."
    if wait_for_http "$APP_URL" 5; then
      ok "Dashboard already running"
      open_browser "$APP_URL"
      info "Reusing existing server at $APP_URL"
      exit 0
    fi
  fi
fi

npm run dev &
DEV_PID=$!

cleanup() {
  if kill -0 "$DEV_PID" 2>/dev/null; then
    kill "$DEV_PID" 2>/dev/null || true
    wait "$DEV_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

if wait_for_http "$APP_URL" 90; then
  ok "Dashboard ready at $APP_URL"
  open_browser "$APP_URL"
else
  die "Server did not become ready at $APP_URL"
fi

# Keep script attached to the dev server
wait "$DEV_PID"
