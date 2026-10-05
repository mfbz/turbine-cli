// The header of the interactive session (DESIGN.md, "The header"): Turbine's logo in Braille, the
// mark turning like a coin in the accent colour, the wordmark still in the terminal's own colour, and
// a tagline that always names the network.
import type { NetworkName } from "../config/network.ts";
import type { Theme } from "../output/theme.ts";
import { LOGO } from "./logo-frames.ts";

type HeaderSize = "full" | "compact" | "line";
type HeaderOptions = {
  size: HeaderSize;
  frame: number;
  theme: Theme;
  network: NetworkName;
};
type PlayOptions = Omit<HeaderOptions, "frame"> & {
  write: (text: string) => void;
  motion: boolean;
  sleep?: (ms: number) => Promise<void>;
};

const FULL_FROM = 80;
const COMPACT_FROM = 56;
// About 14 frames a second; two half turns, then rest.
const FRAME_MS = 70;
const TURNS = 2;
const HIDE_CURSOR = "\u001b[?25l";
const SHOW_CURSOR = "\u001b[?25h";
const CLEAR_LINE = "\u001b[2K";

function headerSize(width: number): HeaderSize {
  if (width >= FULL_FROM) return "full";
  if (width >= COMPACT_FROM) return "compact";
  return "line";
}

function tagline(theme: Theme, network: NetworkName): string {
  const badge =
    network === "mainnet"
      ? theme.warning("▲ mainnet")
      : theme.accent("playground");
  return `${theme.dim("trade slow, pay less ·")} ${badge}`;
}

function renderHeader({ size, frame, theme, network }: HeaderOptions): string {
  if (size === "line")
    return `${theme.accent("▌▌▐▐")} ${theme.bold("Turbine")}  ${tagline(theme, network)}`;
  const logo = LOGO[size];
  const turn = logo.mark[frame % logo.mark.length] ?? logo.mark[0] ?? [];
  const rows = logo.word.map(
    (word, row) => `${theme.accent(turn[row] ?? "")}${word}`
  );
  return [...rows, "", tagline(theme, network)].join("\n");
}

function lineCount(size: HeaderSize): number {
  return size === "line" ? 1 : LOGO[size].height + 2;
}

const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Prints the header; with motion, spins the mark and settles on the rest frame. */
async function playHeader(options: PlayOptions): Promise<void> {
  const { write, size, theme, network } = options;
  const draw = (frame: number) =>
    `${renderHeader({ size, frame, theme, network })}\n`;
  if (!options.motion || size === "line") {
    write(draw(0));
    return;
  }
  const sleep = options.sleep ?? wait;
  const frames = LOGO[size].mark.length;
  const lines = lineCount(size);
  write(HIDE_CURSOR);
  try {
    write(draw(0));
    for (let i = 1; i <= frames * TURNS; i++) {
      await sleep(FRAME_MS);
      // Back to the top of the header, then redraw each line in place.
      const redraw = draw(i % frames)
        .split("\n")
        .map((line) => (line ? `${CLEAR_LINE}${line}` : line))
        .join("\n");
      write(`\u001b[${lines}A${redraw}`);
    }
  } finally {
    write(SHOW_CURSOR);
  }
}

export { headerSize, playHeader, renderHeader };
export type { HeaderSize };
