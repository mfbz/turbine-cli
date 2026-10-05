import { describe, expect, it } from "vitest";

import { PALETTE, createTheme } from "./theme.ts";

const STYLES = [
  "accent",
  "success",
  "warning",
  "error",
  "dim",
  "bold",
] as const;

describe("createTheme", () => {
  it("leaves text untouched without colour", () => {
    const theme = createTheme(0);
    for (const style of STYLES) expect(theme[style]("x")).toBe("x");
  });

  it("uses Turbine's exact colours in truecolor terminals", () => {
    const theme = createTheme(3);
    expect(theme.accent("x")).toContain("38;2;255;51;102");
    expect(theme.success("x")).toContain("38;2;0;255;187");
    expect(theme.warning("x")).toContain("38;2;255;204;0");
  });

  it("uses the nearest 256-colour code where truecolor isn't available", () => {
    expect(createTheme(2).accent("x")).toMatch(/\u001b\[38;5;\d+m/);
  });

  it("falls back to the basic colours that mean the same thing", () => {
    const theme = createTheme(1);
    expect(theme.accent("x")).toContain("\u001b[31m");
    expect(theme.error("x")).toContain("\u001b[31m");
    expect(theme.success("x")).toContain("\u001b[32m");
    expect(theme.warning("x")).toContain("\u001b[33m");
  });

  it("always resets after styling, so colour never leaks into the next text", () => {
    for (const level of [1, 2, 3] as const) {
      const theme = createTheme(level);
      for (const style of STYLES)
        expect(theme[style]("x")).toMatch(/x\u001b\[0m$/);
    }
  });

  it("names the five brand colours", () => {
    expect(PALETTE).toEqual({
      carbon: "#1D2021",
      cloud: "#F5F5F5",
      folly: "#FF3366",
      aquamarine: "#00FFBB",
      jonquil: "#FFCC00",
    });
  });
});
