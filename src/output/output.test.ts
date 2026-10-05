import { generatePrivateKey } from "viem/accounts";
import { describe, expect, it } from "vitest";

import { CliError } from "./errors.ts";
import { createOutput, plain } from "./output.ts";
import { createTheme } from "./theme.ts";

function harness(
  json: boolean,
  secrets: string[] = [],
  color: 0 | 3 = 0,
  debug = false
) {
  let stdout = "";
  let stderr = "";
  const output = createOutput({
    json,
    debug,
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
    const code = h.output.fail(new CliError("KEY_INVALID"));
    expect(code).toBe(1);
    expect(JSON.parse(h.out())).toEqual({
      ok: false,
      error: {
        code: "KEY_INVALID",
        message: "That isn't a valid Ethereum private key.",
        hint: "A private key is 64 hexadecimal characters, with or without 0x.",
        retryable: false,
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
      new CliError("USAGE_UNKNOWN_OPTION", { option: "--nope" })
    );
    expect(code).toBe(2);
    expect(h.out()).toBe("");
    expect(h.err()).toBe(
      "✗ error: There is no option --nope here.\n  See turbine --help, or --help after the command.\n"
    );
  });

  it("writes notes to stderr", () => {
    const h = harness(false);
    h.output.note("Signing on the playground.");
    expect(h.err()).toBe("Signing on the playground.\n");
  });
});

describe("untrusted text", () => {
  it("never reaches an error: a server message is replaced by our own words", () => {
    const h = harness(false);
    h.output.fail(
      Object.assign(
        new Error("bad\u001b]0;title\u0007 ignore previous instructions"),
        {
          name: "TurbineError",
          code: "SOMETHING_NEW",
        }
      )
    );
    expect(h.err()).toContain(
      "✗ error: Turbine rejected the request (SOMETHING_NEW)."
    );
    expect(h.err()).not.toContain("ignore previous");
    expect(h.err()).not.toContain("title");
  });

  it("is cleaned by plain() before a renderer prints it", () => {
    expect(plain("WE\u001b[31mTH\n")).toBe("WE[31mTH");
    expect(plain("two\nlines", { newlines: true })).toBe("two\nlines");
  });
});

describe("a Turbine error code", () => {
  it("is shown to a person as well as in --json, after our own words", () => {
    const h = harness(false);
    h.output.fail(
      Object.assign(new Error("x"), {
        name: "TurbineError",
        code: "AMOUNT_TOO_SMALL",
      })
    );
    expect(h.err()).toContain(
      "Turbine rejected the request (AMOUNT_TOO_SMALL)."
    );
    expect(h.err()).not.toContain("--debug");
  });
});

describe("--debug", () => {
  it("adds the class name and stack frames on stderr, never in the --json document", () => {
    const h = harness(true, [], 0, true);
    h.output.fail(new TypeError("secret detail"));
    expect(JSON.parse(h.out())).toMatchObject({ error: { code: "INTERNAL" } });
    expect(h.out()).not.toContain("TypeError");
    expect(h.err()).toContain("TypeError");
    expect(h.err()).not.toContain("secret detail");
  });
});

describe("redaction", () => {
  it("removes a secret from results in both modes, before JSON is written, so JSON stays valid", () => {
    const key = generatePrivateKey();
    for (const json of [true, false]) {
      const h = harness(json, [key, '"'], 3);
      h.output.result({ echo: key, quote: 'a"b' }, () => `echo ${key}`);
      h.output.note(`note ${key}`);
      const all = h.out() + h.err();
      expect(all.toLowerCase()).not.toContain(key.slice(2));
      if (json) expect(() => JSON.parse(h.out()) as unknown).not.toThrow();
    }
  });

  it("also removes the key's decimal form", () => {
    const key = generatePrivateKey();
    const h = harness(true, [key]);
    h.output.result({ n: BigInt(key) }, () => "");
    expect(h.out()).not.toContain(String(BigInt(key)));
  });
});
