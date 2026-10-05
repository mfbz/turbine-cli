import { describe, expect, it } from "vitest";

import { createTheme } from "../output/theme.ts";
import { headerSize, playHeader, renderHeader } from "./header.ts";
import { LOGO } from "./logo-frames.ts";

const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g;
const PLAIN = createTheme(0);

function visible(text: string): string {
  return text.replace(ANSI, "");
}

describe("headerSize", () => {
  it("picks the full logo from 80 columns, the compact one from 56, one line below that", () => {
    expect(headerSize(120)).toBe("full");
    expect(headerSize(80)).toBe("full");
    expect(headerSize(79)).toBe("compact");
    expect(headerSize(56)).toBe("compact");
    expect(headerSize(55)).toBe("line");
  });
});

describe("renderHeader", () => {
  it("draws the logo rows and a tagline that names the network", () => {
    const lines = renderHeader({
      size: "full",
      frame: 0,
      theme: PLAIN,
      network: "playground",
    }).split("\n");
    expect(lines).toHaveLength(LOGO.full.height + 2);
    for (const line of lines)
      expect([...visible(line)].length).toBeLessThanOrEqual(LOGO.full.width);
    expect(lines.at(-1)).toContain("trade slow, pay less");
    expect(lines.at(-1)).toContain("playground");
  });

  it("marks mainnet so nobody can mistake it for the playground", () => {
    const text = renderHeader({
      size: "compact",
      frame: 0,
      theme: PLAIN,
      network: "mainnet",
    });
    expect(text).toContain("▲ mainnet");
  });

  it("colours the mark with the accent and leaves the wordmark in the terminal's own colour", () => {
    const text = renderHeader({
      size: "full",
      frame: 0,
      theme: createTheme(3),
      network: "playground",
    });
    const firstRow = text.split("\n")[1] ?? "";
    expect(firstRow).toContain("38;2;255;51;102");
    expect(firstRow.split("\u001b[0m").at(-1)).not.toMatch(ANSI);
  });

  it("fits a narrow terminal on one line", () => {
    const text = renderHeader({
      size: "line",
      frame: 0,
      theme: PLAIN,
      network: "playground",
    });
    expect(text.split("\n").filter(Boolean)).toHaveLength(1);
    expect(text).toContain("Turbine");
  });

  it("wraps any frame number onto the turn", () => {
    const at = (frame: number) =>
      renderHeader({
        size: "full",
        frame,
        theme: PLAIN,
        network: "playground",
      });
    expect(at(LOGO.full.mark.length)).toBe(at(0));
  });
});

describe("playHeader", () => {
  it("prints the settled logo once, with no cursor tricks, when motion is off", async () => {
    let out = "";
    await playHeader({
      write: (t) => (out += t),
      size: "full",
      theme: PLAIN,
      network: "playground",
      motion: false,
    });
    expect(out).not.toMatch(/\u001b/);
    expect(out).toBe(
      `${renderHeader({ size: "full", frame: 0, theme: PLAIN, network: "playground" })}\n`
    );
  });

  it("spins, settles on the rest frame, and always gives the cursor back", async () => {
    let out = "";
    await playHeader({
      write: (t) => (out += t),
      size: "compact",
      theme: PLAIN,
      network: "playground",
      motion: true,
      sleep: () => Promise.resolve(),
    });
    expect(out.startsWith("\u001b[?25l")).toBe(true);
    expect(out.endsWith("\u001b[?25h")).toBe(true);
    const settled = renderHeader({
      size: "compact",
      frame: 0,
      theme: PLAIN,
      network: "playground",
    });
    const lastFrame =
      out
        .slice(0, -"\u001b[?25h".length)
        .split(/\u001b\[\d+A/)
        .at(-1) ?? "";
    expect(lastFrame.replace(/\u001b\[2K/g, "")).toBe(`${settled}\n`);
  });

  it("gives the cursor back even when writing fails half way", async () => {
    let out = "";
    let calls = 0;
    await expect(
      playHeader({
        write: (t) => {
          calls++;
          if (calls === 3) throw new Error("gone");
          out += t;
        },
        size: "compact",
        theme: PLAIN,
        network: "playground",
        motion: true,
        sleep: () => Promise.resolve(),
      })
    ).rejects.toThrow("gone");
    expect(out.endsWith("\u001b[?25h")).toBe(true);
  });
});
