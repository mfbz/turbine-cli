import type { NetworkName } from "../config/network.ts";
import { CliError } from "../output/errors.ts";
import type { Theme } from "../output/theme.ts";
import {
  checkAmountFormat,
  formatAmount,
  parseAmount,
  priceOf,
  withSpread,
} from "../turbine/amounts.ts";
import type { Token, TurbineApi } from "../turbine/api.ts";
import { resolvePair } from "../turbine/tokens.ts";

type Amount = { amount: string; atomic: string };
type QuoteInput = {
  amount: string;
  sell: string;
  buy: string;
  spreadBps?: number;
};
type QuoteReport = {
  network: NetworkName;
  sell: { symbol: string; address: string } & Amount;
  buy: { symbol: string; address: string };
  // Buy tokens per sell token, to 18 significant digits; midRatio is the exact value.
  midPrice: string;
  // Buy-token atomic units per sell-token atomic unit, exactly as Turbine quoted it.
  midRatio: { numerator: string; denominator: string };
  atMid: Amount;
  spreadBps: number | null;
  atSpread: Amount | null;
  fee: { percent: string; amount: Amount };
  dexSpreadPercent: string;
};

const BPS = /^-?\d+$/;
// For people: amounts and prices to 8 significant digits. --json carries exact amounts and the exact
// mid price ratio.
const SHOWN = 8;

function amount(atomic: bigint, token: Token): Amount {
  return {
    amount: formatAmount(atomic, token.decimals),
    atomic: atomic.toString(),
  };
}

// Hundredths of a basis point as a percentage (10,000 hbp = 1%): 700 → "0.07".
function percent(hbp: number): string {
  return formatAmount(BigInt(hbp), 4);
}

function parseBps(text: string): number {
  const value = Number(text);
  if (!BPS.test(text.trim()) || !Number.isSafeInteger(value))
    throw new CliError("SPREAD_INVALID");
  withSpread(1n, value);
  return value;
}

async function quoteCommand(
  input: QuoteInput,
  api: TurbineApi,
  network: NetworkName
): Promise<QuoteReport> {
  // A typo is a usage error even when Turbine can't be reached.
  checkAmountFormat(input.amount);
  const { tokens } = await api.info();
  const { sell, buy } = resolvePair(input.sell, input.buy, tokens);
  const sellAmount = parseAmount(input.amount, sell.decimals);
  const quote = await api.quote(sell.address, buy.address, sellAmount);
  const atMid = (sellAmount * quote.mid.numerator) / quote.mid.denominator;
  const spread = input.spreadBps ?? null;
  return {
    network,
    sell: {
      symbol: sell.symbol,
      address: sell.address,
      ...amount(sellAmount, sell),
    },
    buy: { symbol: buy.symbol, address: buy.address },
    midPrice: priceOf(quote.mid, sell.decimals, buy.decimals, 18),
    midRatio: {
      numerator: quote.mid.numerator.toString(),
      denominator: quote.mid.denominator.toString(),
    },
    atMid: amount(atMid, buy),
    spreadBps: spread,
    atSpread: spread === null ? null : amount(withSpread(atMid, spread), buy),
    fee: {
      percent: percent(quote.feeHbp),
      amount: amount(quote.feeAmount, buy),
    },
    dexSpreadPercent: percent(quote.dexSpreadHbp + quote.gasHbp),
  };
}

function renderQuote(report: QuoteReport, theme: Theme): string {
  const shown = (value: string, rounding: "nearest" | "down" = "nearest") => {
    const [whole = "0", fraction = ""] = value.split(".");
    const digits = (whole + fraction).replace(/^0+/, "").length;
    if (digits <= SHOWN) return value;
    const decimals = fraction.length;
    return formatAmount(BigInt(whole + fraction), decimals, SHOWN, rounding);
  };
  const buy = report.buy.symbol;
  const network =
    report.network === "mainnet"
      ? theme.warning("▲ mainnet")
      : theme.accent("playground");
  const rows: Array<[string, string]> = [
    ["mid price", `${shown(report.midPrice)} ${buy} per ${report.sell.symbol}`],
    ["at mid", `${shown(report.atMid.amount)} ${buy}`],
  ];
  if (report.spreadBps !== null && report.atSpread) {
    // A floor: rounded down, so what is shown is never more than what the order guarantees.
    rows.push([
      "your spread",
      `${report.spreadBps} bps → at least ${shown(report.atSpread.amount, "down")} ${buy}`,
    ]);
  }
  rows.push(
    [
      "Turbine fee",
      `${report.fee.percent}% ${theme.dim(`(${shown(report.fee.amount.amount)} ${buy}, in the spread)`)}`,
    ],
    [
      "DEX spread",
      `${report.dexSpreadPercent}% ${theme.dim("(what a swap elsewhere costs now)")}`,
    ]
  );
  const width = Math.max(...rows.map(([label]) => label.length)) + 2;
  return [
    `${theme.bold(`${report.sell.amount} ${report.sell.symbol} → ${buy}`)}  ${theme.dim("on")} ${network}`,
    ...rows.map(
      ([label, value]) => `  ${theme.dim(label.padEnd(width))}${value}`
    ),
  ].join("\n");
}

export { parseBps, quoteCommand, renderQuote };
export type { QuoteReport };
