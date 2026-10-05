// An in-memory Turbine for tests and offline demos: the same interface as the HTTP client, with a
// fixed set of tokens and mid prices.
import { getAddress } from "viem";

import type { Hex } from "../wallet/signer.ts";
import type { ProtocolInfo, Quote, Token, TurbineApi } from "./api.ts";

type Prices = Readonly<Record<string, number>>;

const FAKE_TOKENS: Token[] = [
  {
    address: getAddress("0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"),
    symbol: "WETH",
    decimals: 18,
    tokenClass: "Regular",
  },
  {
    address: getAddress("0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"),
    symbol: "USDC",
    decimals: 6,
    tokenClass: "Stable",
  },
  {
    address: getAddress("0x2260fac5e5542a773aa44fbcfedf7c193bc2c599"),
    symbol: "WBTC",
    decimals: 8,
    tokenClass: "Regular",
  },
];
// USD per whole token.
const FAKE_PRICES: Prices = { WETH: 2500, USDC: 1, WBTC: 60_000 };

function createFakeApi(
  options: { tokens?: Token[]; prices?: Prices; settler?: Hex } = {}
): TurbineApi {
  const tokens = options.tokens ?? FAKE_TOKENS;
  const prices = options.prices ?? FAKE_PRICES;
  const bySymbol = (address: Hex) => {
    const token = tokens.find((t) => t.address === address);
    if (!token)
      throw Object.assign(new Error("unknown"), {
        name: "TurbineError",
        code: "TOKEN_NOT_SUPPORTED",
      });
    return token;
  };
  const info: ProtocolInfo = {
    version: "fake",
    settler: getAddress(
      options.settler ?? "0x5964336d54486f70b6a05b7825021427d99a0e16"
    ),
    lpRouter: getAddress("0xe5b67a998b73c5a5817f56c22b433c4642b7262a"),
    tokens,
    minTradeUsdc: 10_000_000n,
    maxSignatureLifetimeS: 300,
  };
  return {
    info: () => Promise.resolve(info),
    quote(sellToken, buyToken, sellAmount): Promise<Quote> {
      const sell = bySymbol(sellToken);
      const buy = bySymbol(buyToken);
      // Mid in atomic units: USD price ratio, scaled to each token's decimals, as cents to stay whole.
      const numerator =
        BigInt(Math.round((prices[sell.symbol] ?? 1) * 100)) *
        10n ** BigInt(buy.decimals);
      const denominator =
        BigInt(Math.round((prices[buy.symbol] ?? 1) * 100)) *
        10n ** BigInt(sell.decimals);
      const atMid = (sellAmount * numerator) / denominator;
      const feeAmount = (atMid * 7n) / 10_000n;
      return Promise.resolve({
        sellAmount,
        buyAmount: atMid - feeAmount,
        mid: { numerator, denominator },
        dexSpreadHbp: 1200,
        gasHbp: 300,
        feeHbp: 700,
        feeAmount,
      });
    },
  };
}

export { createFakeApi, FAKE_TOKENS };
