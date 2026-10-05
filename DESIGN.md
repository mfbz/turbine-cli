# DESIGN.md: how turbine-cli looks and behaves in a terminal

turbine-cli borrows Turbine's visual identity (an unofficial tool, styled with respect for the original): a dark, quiet palette with one hot accent, generous spacing, numbers you can scan. This file is binding for anything a person sees. `src/output/theme.ts` holds the same values, and `tools/checks/design-md.test.ts` keeps the two in step.

## Palette

| Name       | Hex       | Role in the terminal                                                                                           |
| ---------- | --------- | -------------------------------------------------------------------------------------------------------------- |
| folly      | `#FF3366` | the one accent: the turning mark, the active network, a selected item; also errors (always with ✗ and "error") |
| aquamarine | `#00FFBB` | success: filled, confirmed, done (always with ✓)                                                               |
| jonquil    | `#FFCC00` | warning and mainnet: anything involving real funds (always with ▲ or the word)                                 |
| cloud      | `#F5F5F5` | Turbine's text colour. In a terminal the user's own foreground plays this part, so light themes stay readable  |
| carbon     | `#1D2021` | Turbine's background. Never painted: the terminal's own background plays this part                             |

Fallbacks:

- **Truecolor terminals** get the exact values.
- **256-colour terminals** get the nearest colour in the xterm cube.
- **16-colour terminals** get red for folly, green for aquamarine and yellow for jonquil.
- **`NO_COLOR` or a pipe:** no colour at all.

## Colour discipline

- Plain text is the terminal's default foreground. Secondary text (labels, hints, units) is dim.
- One accent per screen. Status colours only for status.
- Meaning never rests on colour alone: every coloured status has a glyph or a word.

Glyphs: `✓` done, `✗` error, `▲` warning or mainnet, `▼` falling, `•` list item, `›` the selected item or the next step.

## Numbers

- Amounts and prices are right-aligned in their column, with the token symbol after them in dim.
- Values come from the API with full precision; the screen shows what a person needs (significant digits, not 18 decimals), and `--json` always carries the exact value.
- Times are local and relative where it helps ("in 4m 12s", "2m ago").

## The header

`turbine` with no arguments, in an interactive terminal, opens with Turbine's logo drawn in Braille from the official SVG at build time:

- **Full** (74×7 characters) from 80 columns wide; **compact** (53×5) from 56; below that the one-line `▌▌▐▐ Turbine`.
- The mark turns like a coin (rotation about its vertical axis), in folly; the wordmark stays still, in the default foreground.
- One dim line under it: the tagline, and always the network (`playground` in folly, `mainnet` in jonquil with ▲). Nobody should wonder whether funds are real.
- Direct commands (`turbine quote …`), `--help`, `--json` and pipes never show the header.

## Motion

- Motion is decoration and always optional: about 12 frames a second, a short spin that settles, a gentle idle turn while something is pending.
- It is off when the output isn't a terminal, and with `--no-motion`, `TURBINE_NO_MOTION=1`, `NO_COLOR`, `CI` or `TERM=dumb`. Without motion you see the settled frame.
- The cursor is hidden only while animating and is always restored, including on Ctrl-C and on errors.

## Output modes

- **Human** (default): short, aligned, coloured as above. Progress and context go to stderr; the result goes to stdout.
- **`--json`**: exactly one JSON document on stdout, errors included (`{ "ok": true, "data": … }` or `{ "ok": false, "error": { "code", "message", "hint" } }`). No colour, no header, no progress. `order watch --json` is the one stream: one JSON object per line.
- **Piped** without `--json`: the human text without colour or motion.

## Errors

Three parts, two lines at most:

```
✗ error: The wallet file ~/.config/turbine-cli/wallets/main.json can be read by other users of this computer.
  Make it yours only: chmod 600 ~/.config/turbine-cli/wallets/main.json
```

What failed, then (dim) what to do next. Every message and hint comes from turbine-cli's own catalogue (`src/output/errors.ts`), keyed by a stable code: the text of a library error, the Turbine API's message or a value that was typed is never shown. Only a few safe-shaped parameters (a wallet name, a file path, an option name) are filled in. `--debug` adds the error's class and stack frames on stderr, never values. Anything from the API that a command does display (a token symbol, say) is stripped of control characters first.

## Voice

Plain, confident, specific with numbers, like Turbine's own copy ("Trade slow and pay less."). Say what happened and what to do; no exclamation marks, no blame, no jargon a trader wouldn't use.
