import { generatePrivateKey } from "viem/accounts";
import { describe, expect, it } from "vitest";

import { CliError } from "./errors.ts";
import { createOutput, plain } from "./output.ts";
import { createTheme } from "./theme.ts";

function harness(json: boolean, secrets: string[] = [], color: 0 | 3 = 0) {
  let stdout = "";
  let stderr = "";
  const output = createOutput({
    json,
    debug: false,
    theme: createTheme(color),
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
    secrets: () => secrets,
  });
  return { output, out: () => stdout, err: () => stderr };
}

describe("--json output", () => {
  it("writes exactly one document, with big numbers as decimal strings", () => {
    const h = harness(true);
    h.output.result({ amount: 10n ** 20n, token: "WETH" }, () => "human");
    expect(h.out()).toBe(
      '{"ok":true,"data":{"amount":"100000000000000000000","token":"WETH"}}\n'
    );
    expect(h.err()).toBe("");
  });

  it("writes failures as a document on stdout, nothing on stderr, and returns the exit code", () => {
    const h = harness(true);
    const code = h.output.fail(
      new CliError("KEY_INVALID", "Not a key.", { hint: "Use 64 hex." })
    );
    expect(code).toBe(1);
    expect(JSON.parse(h.out())).toEqual({
      ok: false,
      error: {
        code: "KEY_INVALID",
        message: "Not a key.",
        hint: "Use 64 hex.",
      },
    });
    expect(h.err()).toBe("");
  });

  it("keeps notes out of the document", () => {
    const h = harness(true);
    h.output.note("signing…");
    expect(h.out()).toBe("");
    expect(h.err()).toBe("");
  });
});

describe("human output", () => {
  it("writes the rendered text to stdout", () => {
    const h = harness(false);
    h.output.result({ a: 1 }, (theme) => theme.bold("network playground"));
    expect(h.out()).toBe("network playground\n");
  });

  it("writes errors to stderr with a mark, a word and the hint", () => {
    const h = harness(false);
    const code = h.output.fail(
      new CliError("USAGE", "Unknown flag --nope.", {
        hint: "See turbine --help.",
        exitCode: 2,
      })
    );
    expect(code).toBe(2);
    expect(h.out()).toBe("");
    expect(h.err()).toBe(
      "✗ error: Unknown flag --nope.\n  See turbine --help.\n"
    );
  });

  it("writes notes to stderr", () => {
    const h = harness(false);
    h.output.note("Signing on the playground.");
    expect(h.err()).toBe("Signing on the playground.\n");
  });
});

describe("untrusted text", () => {
  it("can't drive the terminal from an error message (escape sequences, bells, carriage returns)", () => {
    const h = harness(false);
    h.output.fail({
      code: "SOMETHING_NEW",
      message: "bad\u001b]0;title\u0007\u001b[2J\rfake ✓ done\u009b31m",
    });
    expect(h.err()).toBe("✗ error: bad]0;title[2Jfake ✓ done31m\n");
  });

  it("offers the same cleaning to renderers for API data", () => {
    expect(plain("WE\u001b[31mTH\n")).toBe("WE[31mTH");
    expect(plain("two\nlines", { newlines: true })).toBe("two\nlines");
  });
});

describe("redaction", () => {
  it("removes the key from everything written, in both modes", () => {
    const key = generatePrivateKey();
    for (const json of [true, false]) {
      const h = harness(json, [key], 3);
      h.output.result({ echo: key }, () => `echo ${key}`);
      h.output.note(`note ${key}`);
      h.output.fail(new Error(`failed near ${key.slice(2)}`));
      const all = h.out() + h.err();
      expect(all.toLowerCase()).not.toContain(key.slice(2));
      expect(all).toContain("[redacted]");
    }
  });
});
