#!/usr/bin/env bash
# Records assets/demo.gif, the terminal demo at the top of the README: the interactive session, a
# ladder, a live watch and a cancel, all against the local mock (no network, no real funds). A
# throwaway wallet lives in a temporary HOME, so nothing of the machine it runs on is on screen.
# Needs asciinema and agg (brew install asciinema agg) and expect (part of macOS). Run with
# `npm run demo:record`. A failed recording leaves the current GIF as it is.
set -euo pipefail

repo="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$repo"
for tool in asciinema agg expect curl; do
  command -v "$tool" >/dev/null || { echo "Needs $tool: brew install asciinema agg" >&2; exit 1; }
done

npm run build --silent

work="$(mktemp -d)"
port=4699
cleanup() {
  [ -n "${mock:-}" ] && kill "$mock" 2>/dev/null || true
  [ -n "$work" ] && rm -rf "$work"
}
trap cleanup EXIT

# Fills every 5 s instead of 6: soon enough not to drag, late enough that the watch opens early.
MOCK_TURBINE_PORT=$port MOCK_TURBINE_FILL_MS=5000 node scripts/mock-turbine.ts >"$work/mock.log" 2>&1 &
mock=$!
# Our mock, on our port, before anything is recorded (another server there would answer too).
for _ in $(seq 1 50); do
  kill -0 "$mock" 2>/dev/null || { cat "$work/mock.log" >&2; exit 1; }
  curl -sf "http://127.0.0.1:$port/api/status" >/dev/null && break
  sleep 0.1
done
curl -sf "http://127.0.0.1:$port/api/status" >/dev/null || { echo "The mock didn't start." >&2; exit 1; }

# `turbine` on PATH runs this checkout's build.
mkdir -p "$work/bin" "$work/home"
cat >"$work/bin/turbine" <<'EOF'
#!/bin/sh
exec node "$TURBINE_DEMO_MAIN" "$@"
EOF
chmod +x "$work/bin/turbine"

# Nothing of this machine's setup: its HOME, config folder, settings or terminal habits.
unset NO_COLOR FORCE_COLOR CI XDG_CONFIG_HOME TURBINE_NETWORK TURBINE_NO_MOTION
export TURBINE_DEMO_MAIN="$repo/dist/main.mjs" HOME="$work/home" PATH="$work/bin:$PATH" TZ=UTC
export TERM=xterm-256color COLORTERM=truecolor BASH_SILENCE_DEPRECATION_WARNING=1
export TURBINE_API_URL="http://127.0.0.1:$port/api" TURBINE_RPC_URL="http://127.0.0.1:$port/rpc"
export TURBINE_ACCOUNT=demo TURBINE_WALLET_PASSWORD=demo-wallet-password
turbine wallet new demo --json >/dev/null

# --return: a demo that failed part way fails the recording, instead of becoming the GIF.
asciinema rec --overwrite --headless --return --window-size 120x30 \
  --command "expect $(printf '%q' "$repo/scripts/demo/demo.exp")" "$work/demo.cast"

# An empty Braille cell (U+2800) is blank in a terminal, but agg draws its dots as faint outlines:
# render it as the space it stands for. Monaco keeps "--" as two hyphens (Menlo joins them).
perl -CSD -pi -e 's/\x{2800}/ /g; s/\\u2800/ /gi' "$work/demo.cast"

# Turbine's carbon and cloud for the background and text; the CLI draws its own colours.
agg --theme 1d2021,f5f5f5,1d2021,ff3366,00ffbb,ffcc00,7aa2f7,bb9af7,7dcfff,a9b1d6,565f89,ff3366,00ffbb,ffcc00,7aa2f7,bb9af7,7dcfff,f5f5f5 \
  --font-dir /System/Library/Fonts --text-font-family "Monaco,Apple Braille" \
  --font-size 16 --idle-time-limit 2 --last-frame-duration 4 \
  "$work/demo.cast" "$work/demo.gif"
mv "$work/demo.gif" "$repo/assets/demo.gif"
echo "Wrote assets/demo.gif ($(du -h "$repo/assets/demo.gif" | cut -f1))"
