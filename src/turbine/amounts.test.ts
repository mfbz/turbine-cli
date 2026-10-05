import { describe, expect, it } from "vitest";

import { CliError } from "../output/errors.ts";
import {
  formatAmount,
  parseAmount,
  parseDuration,
  priceOf,
  withSpread,
} from "./amounts.ts";

function thrown(fn: () => unknown): CliError {
  try {
    fn();
  } catch (error) {
    if (error instanceof CliError) return error;
    throw error;
  }
  throw new Error("expected a CliError");
}

describe("parseAmount", () => {
  it("reads decimal amounts exactly, in the token's units", () => {
    expect(parseAmount("1.5", 18)).toBe(1_500_000_000_000_000_000n);
    expect(parseAmount("100", 6)).toBe(100_000_000n);
    expect(parseAmount("0.000001", 6)).toBe(1n);
  });

  it("refuses what isn't a positive amount the token can hold", () => {
    for (const text of ["0", "-1", "abc", "1e3", "", "1.2.3", " "]) {
      expect(thrown(() => parseAmount(text, 6)).code, text).toBe(
        "AMOUNT_INVALID"
      );
    }
    expect(thrown(() => parseAmount("0.0000001", 6)).code).toBe(
      "AMOUNT_TOO_PRECISE"
    );
  });
});

describe("amount bounds", () => {
  it("refuses amounts beyond what a token amount can hold (uint256)", () => {
    expect(thrown(() => parseAmount("9".repeat(100), 0)).code).toBe(
      "AMOUNT_INVALID"
    );
  });
});

describe("rounding down", () => {
  it("never shows more than the real amount when asked to round down", () => {
    expect(formatAmount(832_957_797n, 6, 7, "down")).toBe("832.9577");
    expect(formatAmount(832_957_797n, 6, 7)).toBe("832.9578");
  });
});

describe("formatAmount", () => {
  it("writes atomic amounts back as plain decimals, without trailing zeros", () => {
    expect(formatAmount(1_500_000_000_000_000_000n, 18)).toBe("1.5");
    expect(formatAmount(100_000_000n, 6)).toBe("100");
    expect(formatAmount(1n, 6)).toBe("0.000001");
  });

  it("rounds to significant digits for people, never for machines", () => {
    expect(formatAmount(123_456_789_012n, 6, 6)).toBe("123457");
    expect(formatAmount(1_234_567n, 6, 4)).toBe("1.235");
    expect(formatAmount(1_234n, 18, 3)).toBe("0.00000000000000123");
  });
});

describe("priceOf", () => {
  it("turns an atomic mid price (buy-wei per sell-wei) into buy tokens per sell token", () => {
    // 1 WETH (18) = 2,500 USDC (6): 2500e6 / 1e18 atomic per atomic.
    expect(
      priceOf({ numerator: 2_500_000_000n, denominator: 10n ** 18n }, 18, 6)
    ).toBe("2500");
    expect(
      priceOf({ numerator: 10n ** 18n, denominator: 2_500_000_000n }, 6, 18)
    ).toBe("0.0004");
  });
});

describe("tiny prices", () => {
  it("keep their significant digits instead of reading 0", () => {
    // 1 atomic unit of a 0-decimal token buys 1e6 atomic units of a 36-decimal one.
    expect(priceOf({ numerator: 1_000_000n, denominator: 1n }, 0, 36)).toBe(
      "0.000000000000000000000000000001"
    );
  });
});

describe("withSpread", () => {
  it("applies a spread in basis points: positive is worse than mid, negative better", () => {
    expect(withSpread(1_000_000n, 50)).toBe(995_000n);
    expect(withSpread(1_000_000n, -20)).toBe(1_002_000n);
    expect(withSpread(1_000_000n, 0)).toBe(1_000_000n);
  });

  it("refuses spreads Turbine doesn't accept", () => {
    for (const bps of [10_000, -10_001, 1.5]) {
      expect(thrown(() => withSpread(1n, bps)).code, String(bps)).toBe(
        "SPREAD_INVALID"
      );
    }
  });
});

describe("parseDuration", () => {
  it("reads seconds, minutes, hours and days", () => {
    expect(parseDuration("90s")).toBe(90);
    expect(parseDuration("15m")).toBe(900);
    expect(parseDuration("4h")).toBe(14_400);
    expect(parseDuration("2d")).toBe(172_800);
    expect(parseDuration("1h30m")).toBe(5_400);
  });

  it("refuses anything else", () => {
    for (const text of ["", "10", "1w", "-5m", "m", "1.5h"]) {
      expect(thrown(() => parseDuration(text)).code, text).toBe(
        "DURATION_INVALID"
      );
    }
  });
});
