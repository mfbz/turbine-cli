import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { buildLogo, renderModule } from "./build-logo.ts";

const SVG = readFileSync(
  new URL("../assets/brand/turbine-logo.svg", import.meta.url),
  "utf8"
);
const logo = buildLogo(SVG);

function dots(line: string): number {
  return [...line].reduce(
    (n, ch) => n + ((ch.codePointAt(0) ?? 0x2800) - 0x2800 > 0 ? 1 : 0),
    0
  );
}

describe("the logo frames", () => {
  it("come in the two sizes DESIGN.md names, as rows of exactly that width", () => {
    expect([logo.full.width, logo.full.height]).toEqual([74, 7]);
    expect([logo.compact.width, logo.compact.height]).toEqual([53, 5]);
    for (const size of [logo.full, logo.compact]) {
      expect(size.word).toHaveLength(size.height);
      for (const frame of size.mark) {
        expect(frame).toHaveLength(size.height);
        for (const row of frame) expect([...row]).toHaveLength(size.markWidth);
      }
      for (const row of size.word)
        expect([...row]).toHaveLength(size.width - size.markWidth);
    }
  });

  it("turn the mark like a coin: full width at rest, a sliver edge-on", () => {
    const rest = logo.full.mark[0] ?? [];
    const edge = logo.full.mark[Math.floor(logo.full.mark.length / 2)] ?? [];
    const width = (frame: string[]) =>
      frame.reduce((n, row) => n + dots(row), 0);
    expect(width(rest)).toBeGreaterThan(width(edge) * 3);
  });

  it("use only Braille characters", () => {
    const all = [
      ...logo.full.word,
      ...logo.full.mark.flat(),
      ...logo.compact.word,
      ...logo.compact.mark.flat(),
    ].join("");
    expect(all).toMatch(/^[⠀-⣿]*$/u);
  });

  it("are committed exactly as the generator writes them (run npm run logo:build after changing it)", () => {
    const committed = readFileSync(
      new URL("../src/ui/logo-frames.ts", import.meta.url),
      "utf8"
    );
    expect(committed).toBe(renderModule(logo));
  });
});
