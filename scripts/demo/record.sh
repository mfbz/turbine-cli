#!/usr/bin/env bash
# Records assets/demo.gif, the terminal demo at the top of the README: the interactive session, a
# ladder, a live watch and a cancel, all against the local mock (no network, no real funds). A
# throwaway wallet lives in a temporary HOME, so nothing of the machine it runs on is on screen.
# Needs asciinema and agg (brew install asciinema agg) and expect (part of macOS). Run with
# `npm run demo:record`.
set -euo pipefail

repo="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$repo"
for tool in asciinema agg expect; do
  command -v "$tool" >/dev/null || { echo "Needs $tool: brew install asciinema agg" >&2; exit 1; }
done

npm run build --silent

work="$(mktemp -d)"
port=4699
cleanup() {
  kill "${mock:-}" 2>/dev/null || true
  rm -rf "$work"
}
trap cleanup EXIT

# Fills every 5 s instead of 6: soon enough not to drag, late enough that the watch opens at 0%.
MOCK_TURBINE_PORT=$port MOCK_TURBINE_FILL_MS=5000 node scripts/mock-turbine.ts >/dev/null &
mock=$!
sleep 1

mkdir -p "$work/bin"
printf '#!/bin/sh\nexec node "%s/dist/main.mjs" "$@"\n' "$repo" >"$work/bin/turbine"
chmod +x "$work/bin/turbine"

export HOME="$work/home" PATH="$work/bin:$PATH" TERM=xterm-256color COLORTERM=truecolor
export TURBINE_API_URL="http://127.0.0.1:$port/api" TURBINE_RPC_URL="http://127.0.0.1:$port/rpc"
export TURBINE_ACCOUNT=demo TURBINE_WALLET_PASSWORD=demo-wallet-password
unset NO_COLOR TURBINE_NETWORK TURBINE_NO_MOTION
mkdir -p "$HOME"
turbine wallet new demo --json >/dev/null

asciinema rec --overwrite --headless --window-size 120x30 \
  --command "expect $repo/scripts/demo/demo.exp" "$work/demo.cast"

# An empty Braille cell (U+2800) is blank in a terminal, but agg draws its dots as faint outlines:
# render it as the space it stands for. Monaco keeps "--" as two hyphens (Menlo joins them).
perl -CSD -pi -e 's/\x{2800}/ /g; s/\\u2800/ /gi' "$work/demo.cast"

# Turbine's carbon and cloud for the background and text; the CLI draws its own colours.
agg --theme 1d2021,f5f5f5,1d2021,ff3366,00ffbb,ffcc00,7aa2f7,bb9af7,7dcfff,a9b1d6,565f89,ff3366,00ffbb,ffcc00,7aa2f7,bb9af7,7dcfff,f5f5f5 \
  --font-dir /System/Library/Fonts --text-font-family "Monaco,Apple Braille" \
  --font-size 16 --idle-time-limit 2 --last-frame-duration 4 \
  "$work/demo.cast" "$repo/assets/demo.gif"
echo "Wrote assets/demo.gif ($(du -h "$repo/assets/demo.gif" | cut -f1))"
