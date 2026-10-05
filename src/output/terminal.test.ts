import { describe, expect, it } from "vitest";

import { detectTerminal } from "./terminal.ts";

const tty = (depth = 24, columns = 120) => ({
  isTTY: true,
  columns,
  getColorDepth: () => depth,
});
const MOTION = { motion: true };

describe("detectTerminal", () => {
  it("uses no colour and no motion when piped, with a sensible width", () => {
    expect(detectTerminal({ isTTY: false }, {}, MOTION)).toEqual({
      tty: false,
      width: 80,
      color: 0,
      motion: false,
    });
  });

  it("maps the terminal's colour depth to a level", () => {
    expect(detectTerminal(tty(24), {}, MOTION).color).toBe(3);
    expect(detectTerminal(tty(8), {}, MOTION).color).toBe(2);
    expect(detectTerminal(tty(4), {}, MOTION).color).toBe(1);
    expect(detectTerminal(tty(1), {}, MOTION).color).toBe(0);
  });

  it("honours NO_COLOR when it is set to anything but empty", () => {
    expect(detectTerminal(tty(), { NO_COLOR: "1" }, MOTION).color).toBe(0);
    expect(detectTerminal(tty(), { NO_COLOR: "" }, MOTION).color).toBe(3);
  });

  it("honours FORCE_COLOR when piped", () => {
    expect(
      detectTerminal({ isTTY: false }, { FORCE_COLOR: "1" }, MOTION).color
    ).toBe(1);
    expect(
      detectTerminal({ isTTY: false }, { FORCE_COLOR: "3" }, MOTION).color
    ).toBe(3);
  });

  it("turns motion off for CI, dumb terminals, NO_COLOR, TURBINE_NO_MOTION and --no-motion", () => {
    for (const env of [
      { CI: "true" },
      { TERM: "dumb" },
      { NO_COLOR: "1" },
      { TURBINE_NO_MOTION: "1" },
    ]) {
      expect(
        detectTerminal(tty(), env, MOTION).motion,
        JSON.stringify(env)
      ).toBe(false);
    }
    expect(detectTerminal(tty(), {}, { motion: false }).motion).toBe(false);
    expect(detectTerminal(tty(), {}, MOTION).motion).toBe(true);
  });

  it("reports the real width, however narrow", () => {
    expect(detectTerminal(tty(24, 30), {}, MOTION).width).toBe(30);
  });
});
