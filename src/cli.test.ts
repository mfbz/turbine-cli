import { describe, expect, it } from "vitest";

import pkg from "../package.json" with { type: "json" };
import { run } from "./cli.ts";

function capture(argv: string[]) {
  let out = "";
  let err = "";
  const code = run(argv, {
    out: (text) => (out += text),
    err: (text) => (err += text),
  });
  return { code, out, err };
}

describe("run", () => {
  it("prints the package version for --version and -v", () => {
    for (const flag of ["--version", "-v"]) {
      expect(capture([flag])).toEqual({
        code: 0,
        out: `${pkg.version}\n`,
        err: "",
      });
    }
  });

  it("prints usage on stdout for --help", () => {
    const { code, out, err } = capture(["--help"]);
    expect(code).toBe(0);
    expect(out).toContain("Usage");
    expect(err).toBe("");
  });

  it("rejects an unknown flag on stderr with exit code 2 and nothing on stdout", () => {
    const { code, out, err } = capture(["--nope"]);
    expect(code).toBe(2);
    expect(out).toBe("");
    expect(err).toContain("--nope");
    expect(err).toContain("Usage");
  });

  it("never colours plain output", () => {
    expect(capture(["--help"]).out).not.toMatch(/\u001b\[/);
  });
});
