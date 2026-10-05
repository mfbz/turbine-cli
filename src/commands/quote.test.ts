import { describe, expect, it } from "vitest";

import { CliError } from "../output/errors.ts";
import { createTheme } from "../output/theme.ts";
import { createFakeApi } from "../turbine/fake-api.ts";
import { parseBps, quoteCommand, renderQuote } from "./quote.ts";

const api = createFakeApi();

describe("turbine quote", () => {
  it("reports the mid price, the amount at mid and the fee, exactly", async () => {
    const report = await quoteCommand(
      { amount: "1", sell: "weth", buy: "USDC" },
      api,
      "playground"
    );
    expect(report).toMatchObject({
      network: "playground",
      sell: { symbol: "WETH", amount: "1", atomic: "1000000000000000000" },
      buy: { symbol: "USDC" },
      midPrice: "2500",
      atMid: { amount: "2500", atomic: "2500000000" },
      spreadBps: null,
      atSpread: null,
      fee: { percent: "0.07", amount: { amount: "1.75", atomic: "1750000" } },
      dexSpreadPercent: "0.15",
    });
  });

  it("shows what a spread would mean: the least you'd receive at its edge", async () => {
    const worse = await quoteCommand(
      { amount: "1", sell: "WETH", buy: "USDC", spreadBps: 50 },
      api,
      "playground"
    );
    expect(worse.atSpread).toEqual({ amount: "2487.5", atomic: "2487500000" });
    const better = await quoteCommand(
      { amount: "1", sell: "WETH", buy: "USDC", spreadBps: -20 },
      api,
      "playground"
    );
    expect(better.atSpread?.amount).toBe("2505");
  });

  it("renders a readable summary with the network named", async () => {
    const report = await quoteCommand(
      { amount: "2", sell: "WETH", buy: "USDC", spreadBps: 50 },
      api,
      "mainnet"
    );
    const text = renderQuote(report, createTheme(0));
    for (const piece of [
      "2 WETH → USDC",
      "▲ mainnet",
      "2500 USDC per WETH",
      "5000 USDC",
      "50 bps",
      "4975 USDC",
      "0.07%",
    ])
      expect(text).toContain(piece);
  });

  it("refuses an unknown token and the same token twice", async () => {
    await expect(
      quoteCommand(
        { amount: "1", sell: "DOGE", buy: "USDC" },
        api,
        "playground"
      )
    ).rejects.toMatchObject({ code: "TOKEN_UNKNOWN" });
    await expect(
      quoteCommand(
        { amount: "1", sell: "USDC", buy: "usdc" },
        api,
        "playground"
      )
    ).rejects.toMatchObject({ code: "SAME_TOKEN" });
  });
});

describe("parseBps", () => {
  it("reads whole basis points and refuses anything else", () => {
    expect(parseBps("50")).toBe(50);
    expect(parseBps("-10")).toBe(-10);
    for (const text of ["1.5", "abc", "", "10000"]) {
      expect(() => parseBps(text), text).toThrow(CliError);
    }
  });
});
