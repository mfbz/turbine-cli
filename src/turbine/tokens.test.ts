import { describe, expect, it } from "vitest";

import { CliError } from "../output/errors.ts";
import type { Token } from "./api.ts";
import { resolvePair, resolveToken } from "./tokens.ts";

const TOKENS: Token[] = [
  {
    address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    symbol: "WETH",
    decimals: 18,
    tokenClass: "Regular",
  },
  {
    address: "0xA0b86991c6218b36c1D19D4a2e9Eb0cE3606eB48",
    symbol: "USDC",
    decimals: 6,
    tokenClass: "Stable",
  },
];

function thrown(fn: () => unknown): CliError {
  try {
    fn();
  } catch (error) {
    if (error instanceof CliError) return error;
    throw error;
  }
  throw new Error("expected a CliError");
}

describe("resolveToken", () => {
  it("finds a token by symbol in any case, or by address", () => {
    expect(resolveToken("weth", TOKENS).symbol).toBe("WETH");
    expect(
      resolveToken("0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", TOKENS).symbol
    ).toBe("USDC");
  });

  it("names a token it doesn't know and says where to look", () => {
    const error = thrown(() => resolveToken("DOGE", TOKENS));
    expect(error.code).toBe("TOKEN_UNKNOWN");
    expect(error.params).toEqual({ token: "DOGE" });
  });
});

describe("ambiguous symbols", () => {
  it("are refused, asking for the address instead", () => {
    const twice = [
      ...TOKENS,
      {
        ...TOKENS[0]!,
        address: "0x0000000000000000000000000000000000000001" as const,
      },
    ];
    expect(thrown(() => resolveToken("WETH", twice)).code).toBe(
      "TOKEN_AMBIGUOUS"
    );
    expect(resolveToken(TOKENS[0]!.address, twice).symbol).toBe("WETH");
  });
});

describe("resolvePair", () => {
  it("refuses the same token on both sides", () => {
    expect(thrown(() => resolvePair("WETH", "weth", TOKENS)).code).toBe(
      "SAME_TOKEN"
    );
  });
});
