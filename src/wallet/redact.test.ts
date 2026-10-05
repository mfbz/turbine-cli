import { generatePrivateKey } from "viem/accounts";
import { describe, expect, it } from "vitest";

import { redact } from "./redact.ts";

describe("redact", () => {
  it("replaces the key with or without 0x, in any case, every time it appears", () => {
    const key = generatePrivateKey();
    const bare = key.slice(2);
    const text = `a ${key} b ${bare.toUpperCase()} c ${key}`;
    expect(redact(text, [key])).toBe("a [redacted] b [redacted] c [redacted]");
  });

  it("leaves other hex alone, such as transaction hashes", () => {
    const key = generatePrivateKey();
    const txHash = generatePrivateKey();
    expect(redact(`tx ${txHash}`, [key])).toBe(`tx ${txHash}`);
  });

  it("changes nothing when there are no secrets", () => {
    expect(redact("hello", [])).toBe("hello");
  });

  it("never lets a secret through, wherever it sits in the text", () => {
    for (let i = 0; i < 200; i++) {
      const key = generatePrivateKey();
      const cut = i % 60;
      const text = `${"x".repeat(cut)}${i % 2 ? key : key.slice(2)}${"y".repeat(i % 7)}`;
      const out = redact(text, [key]);
      expect(out.toLowerCase()).not.toContain(key.slice(2).toLowerCase());
    }
  });
});
