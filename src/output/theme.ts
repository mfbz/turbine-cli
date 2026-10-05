import type { ColorLevel } from "./terminal.ts";

type Style = (text: string) => string;
type Theme = {
  accent: Style;
  success: Style;
  warning: Style;
  error: Style;
  dim: Style;
  bold: Style;
};

// Turbine's own palette (DESIGN.md). Cloud and carbon are the app's text and background; in a terminal
// the user's own foreground and background play those parts, so light themes stay readable.
const PALETTE = {
  carbon: "#1D2021",
  cloud: "#F5F5F5",
  folly: "#FF3366",
  aquamarine: "#00FFBB",
  jonquil: "#FFCC00",
} as const;
const RESET = "\u001b[0m";
// The basic colour that means the same thing, for 16-colour terminals.
const BASIC: Readonly<Record<string, number>> = {
  [PALETTE.folly]: 31,
  [PALETTE.aquamarine]: 32,
  [PALETTE.jonquil]: 33,
};

function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// The nearest colour in xterm's 6×6×6 cube (codes 16–231).
function to256([r, g, b]: [number, number, number]): number {
  const step = (v: number) => Math.round((v / 255) * 5);
  return 16 + 36 * step(r) + 6 * step(g) + step(b);
}

function sgr(code: string): Style {
  return (text) => `\u001b[${code}m${text}${RESET}`;
}

function colour(hex: string, level: ColorLevel): Style {
  if (level === 3) return sgr(`38;2;${rgb(hex).join(";")}`);
  if (level === 2) return sgr(`38;5;${to256(rgb(hex))}`);
  return sgr(String(BASIC[hex] ?? 39));
}

function createTheme(level: ColorLevel): Theme {
  if (level === 0) {
    const plain: Style = (text) => text;
    return {
      accent: plain,
      success: plain,
      warning: plain,
      error: plain,
      dim: plain,
      bold: plain,
    };
  }
  return {
    accent: colour(PALETTE.folly, level),
    success: colour(PALETTE.aquamarine, level),
    warning: colour(PALETTE.jonquil, level),
    // Folly is both the accent and the error colour; errors always carry a glyph or word too.
    error: colour(PALETTE.folly, level),
    dim: sgr("2"),
    bold: sgr("1"),
  };
}

export { PALETTE, createTheme };
export type { Style, Theme };
