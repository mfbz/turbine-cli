import { describe, expect, it } from "vitest";

import {
  checkFile,
  checkMessage,
  findAttribution,
  findHomePath,
  findSecrets,
  isBinary,
} from "./guards.ts";

// Secret-shaped samples are assembled at run time, so this file never contains one.
const sample = (...parts: string[]) => parts.join("");
const HEX64 = "ab".repeat(32);

describe("the secret guard", () => {
  it("finds keys and tokens, and reports only their start", () => {
    const cases = [
      sample("-----BEGIN ", "EC PRIVATE KEY-----"),
      sample("sk-", "ant-", "b2".repeat(20)),
      sample("gh", "p_", "c".repeat(36)),
      sample("github", "_pat_", "d".repeat(50)),
      sample("AK", "IA", "ABCDEFGHIJKLMNOP"),
      sample("npm", "_", "e".repeat(36)),
      sample("xo", "xb-", "1234567890-abc"),
      sample("AI", "za", "f".repeat(35)),
    ];
    for (const secret of cases) {
      const found = findSecrets(`const key = "${secret}";`);
      expect(found, secret.slice(0, 6)).toHaveLength(1);
      expect(found[0]?.match).not.toContain(secret.slice(10));
    }
  });

  it("finds an Ethereum private key assigned to a key-like name, with or without 0x", () => {
    for (const line of [
      sample("TURBINE_PRIVATE", "_KEY=0x", HEX64),
      sample('privateKey: "', HEX64, '"'),
      sample("const pk = '0x", HEX64, "'"),
      sample("signer_key = ", HEX64),
      sample('{ "private', '_key": "0x', HEX64, '" }'),
    ]) {
      const found = findSecrets(line);
      expect(found, line.slice(0, 12)).toHaveLength(1);
      expect(found[0]?.match).not.toContain(HEX64.slice(0, 16));
    }
  });

  it("finds a seed phrase assigned to a mnemonic-like name", () => {
    const words = "abandon ".repeat(11) + "about";
    expect(findSecrets(sample('MNEMONIC="', words, '"'))).toHaveLength(1);
    expect(findSecrets(sample("seed_phrase: ", words))).toHaveLength(1);
  });

  it("leaves hashes, order ids, addresses and placeholders alone", () => {
    expect(findSecrets(sample('txHash: "0x', HEX64, '"'))).toEqual([]);
    expect(findSecrets(sample("orderId = 0x", HEX64))).toEqual([]);
    expect(findSecrets(sample("spk = 0x", HEX64))).toEqual([]);
    expect(findSecrets("TURBINE_PRIVATE_KEY=")).toEqual([]);
    expect(findSecrets('privateKey: "0x…" read from TURBINE_KEY_FILE')).toEqual(
      []
    );
    expect(findSecrets("mnemonic: use your own words, never ours")).toEqual([]);
  });
});

describe("the authorship guard", () => {
  it("finds AI attribution trailers and lines", () => {
    expect(
      findAttribution(sample("Co-Authored", "-By: Some Model <x@y.z>"))
    ).toHaveLength(1);
    expect(findAttribution(sample("noreply@", "anthropic.com"))).toHaveLength(
      1
    );
    expect(
      findAttribution(sample("Generated with ", "[Claude Code]"))
    ).toHaveLength(1);
  });

  it("allows the rule that forbids them", () => {
    expect(
      findAttribution("no `Co-Authored-By` trailers for coding agents")
    ).toEqual([]);
  });
});

describe("the personal path guard", () => {
  it("finds the home folder of whoever runs it", () => {
    expect(
      findHomePath("--key /Users/someone/k.txt", "/Users/someone")
    ).toHaveLength(1);
    expect(findHomePath("--key ./k.txt", "/Users/someone")).toEqual([]);
  });
});

describe("one file about to be committed", () => {
  it("is refused when over 1 MB, and binary content is not scanned for text", () => {
    expect(checkFile("big.txt", Buffer.alloc(1_100_000, 120), "/h")).toEqual([
      "big.txt: over 1 MB",
    ]);
    const binary = Buffer.concat([
      Buffer.from([0]),
      Buffer.from(sample("gh", "p_", "c".repeat(36))),
    ]);
    expect(checkFile("logo.png", binary, "/h")).toEqual([]);
  });
});

describe("commit messages", () => {
  it("are checked for attribution and secrets", () => {
    expect(
      checkMessage("feat: quote\n\n" + sample("Co-Authored", "-By: X <x@y.z>"))
    ).toHaveLength(1);
    expect(checkMessage("fix: order watch redraw")).toEqual([]);
  });
});

describe("binary files", () => {
  it("are told apart from text by a NUL byte", () => {
    expect(isBinary(Buffer.from([0x50, 0x4b, 0x00, 0x01]))).toBe(true);
    expect(isBinary(Buffer.from("plain text"))).toBe(false);
  });
});
