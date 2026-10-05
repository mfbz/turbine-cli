// An in-memory Turbine for tests and offline demos: the same interface as the HTTP client, with a
// fixed set of tokens and mid prices.
import type { Hex } from "../wallet/signer.ts";
import type { ProtocolInfo, Quote, Token, TurbineApi } from "./api.ts";

type Prices = Readonly<Record<string, number>>;

const FAKE_TOKENS: Token[] = [
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
  {
    address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
    symbol: "WBTC",
    decimals: 8,
    tokenClass: "Regular",
  },
];
// USD per whole token.
const FAKE_PRICES: Prices = { WETH: 2500, USDC: 1, WBTC: 60_000 };

function createFakeApi(
  options: { tokens?: Token[]; prices?: Prices } = {}
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
    settler: "0x2aaDB59279619CB33D34aD1A3696e23A2EFfb394",
    lpRouter: "0x769EaD430c4D613Ef1852a3c7B88371588602BcF",
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
