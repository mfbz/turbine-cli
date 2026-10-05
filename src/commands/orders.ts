// turbine orders: the wallet's orders as turbine-cli reports them (exact amounts in --json, one
// readable line each for a person). turbine order watch uses the same report.
import type { OrderState, OrderStatus } from "turbine-sdk";

import { CliError } from "../output/errors.ts";
import type { Theme } from "../output/theme.ts";
import { formatAmount, priceOf } from "../turbine/amounts.ts";
import type { Token } from "../turbine/api.ts";

type Amount = { amount: string; atomic: string };
type Side = { symbol: string; address: string } & Amount;
type Fill = {
  txHash: string;
  clearedAt: string;
  sold: Amount;
  bought: Amount;
  // Buy tokens per sell token for this fill.
  price: string | null;
};
type OrderReport = {
  hash: string;
  status: string;
  sell: Side | null;
  buy: { symbol: string; address: string } | null;
  sold: Amount | null;
  bought: Amount | null;
  filledPercent: string | null;
  limitPrice: string | null;
  createdAt: string | null;
  endsAt: string | null;
  secondsLeft: number | null;
  fills: Fill[];
};

const STATUS_WORDS: Readonly<Record<string, OrderStatus>> = {
  active: "Active",
  filled: "Filled",
  expired: "Expired",
  canceled: "Canceled",
  cancelled: "Canceled",
  cancelling: "PendingCancellation",
  invalid: "Invalid",
  incompatible: "Incompatible",
};
// How each status reads for a person, and which colour it gets.
const STATUS_LOOK: Readonly<
  Record<
    string,
    { word: string; tone: "accent" | "success" | "warning" | "dim" }
  >
> = {
  Active: { word: "active", tone: "accent" },
  Filled: { word: "filled", tone: "success" },
  Expired: { word: "expired", tone: "dim" },
  Canceled: { word: "cancelled", tone: "dim" },
  PendingCancellation: { word: "cancelling", tone: "warning" },
  Invalid: { word: "invalid", tone: "warning" },
  Incompatible: { word: "incompatible", tone: "warning" },
};

function parseStatuses(text: string): OrderStatus[] {
  return text
    .split(",")
    .map((word) => word.trim().toLowerCase())
    .filter(Boolean)
    .map((word) => {
      const status = STATUS_WORDS[word];
      if (!status) throw new CliError("STATUS_UNKNOWN", { status: word });
      return status;
    });
}

// Text from Turbine's API reaches terminals and agents' contexts: only values of the expected shape
// pass, so nothing it says can carry escape sequences or instructions.
const HEX32 = /^0x[0-9a-fA-F]{64}$/;
const KNOWN = new Set(Object.keys(STATUS_LOOK));

function safeHash(value: string): string {
  return HEX32.test(value) ? value : "unknown";
}

function safeStatus(value: string): string {
  return KNOWN.has(value) ? value : "Unknown";
}

function humanDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function find(tokens: readonly Token[], address: string): Token | undefined {
  return tokens.find((t) => t.address.toLowerCase() === address.toLowerCase());
}

function orderReport(
  order: OrderState,
  tokens: readonly Token[],
  now: number
): OrderReport {
  const details = order.orderDetails;
  const sell = details ? find(tokens, details.sellToken) : undefined;
  const buy = details ? find(tokens, details.buyToken) : undefined;
  const amount = (atomic: bigint, token: Token | undefined): Amount => ({
    amount: token ? formatAmount(atomic, token.decimals) : atomic.toString(),
    atomic: atomic.toString(),
  });
  const price = (bought: bigint, sold: bigint): string | null =>
    sell && buy && sold > 0n
      ? priceOf(
          { numerator: bought, denominator: sold },
          sell.decimals,
          buy.decimals
        )
      : null;
  return {
    hash: safeHash(order.hash),
    status: safeStatus(order.status),
    sell:
      details && sell
        ? {
            symbol: sell.symbol,
            address: sell.address,
            ...amount(details.sellAmount, sell),
          }
        : null,
    buy: details && buy ? { symbol: buy.symbol, address: buy.address } : null,
    sold: details ? amount(order.executedSellAmount, sell) : null,
    bought: details ? amount(order.executedBuyAmount, buy) : null,
    filledPercent:
      details && details.sellAmount > 0n
        ? formatAmount(
            (order.executedSellAmount * 10_000n) / details.sellAmount,
            2
          )
        : null,
    limitPrice:
      // A floor of one atomic unit is what an order without --limit carries.
      details &&
      sell &&
      buy &&
      details.limitPrice.denominator > 0n &&
      details.limitPrice.numerator > 1n
        ? priceOf(details.limitPrice, sell.decimals, buy.decimals)
        : null,
    createdAt: details ? details.createdTimestamp.toISOString() : null,
    endsAt: details
      ? new Date(Number(details.endTime) * 1000).toISOString()
      : null,
    secondsLeft: details ? Math.max(0, Number(details.endTime) - now) : null,
    fills: order.execution.map((fill) => ({
      txHash: safeHash(fill.txHash),
      clearedAt: fill.clearedAt.toISOString(),
      sold: amount(fill.soldAmount, sell),
      bought: amount(fill.boughtAmount, buy),
      price: price(fill.boughtAmount, fill.soldAmount),
    })),
  };
}

function statusWord(status: string, theme: Theme): string {
  const look = STATUS_LOOK[status] ?? {
    word: status.toLowerCase(),
    tone: "dim" as const,
  };
  return theme[look.tone](look.word);
}

function renderOrders(orders: readonly OrderReport[], theme: Theme): string {
  if (orders.length === 0)
    return theme.dim("No orders yet. Place one with turbine order place.");
  return orders
    .map((o) => {
      const pair =
        o.sell && o.buy
          ? `${o.sell.amount} ${o.sell.symbol} → ${o.buy.symbol}`
          : theme.dim("details unavailable");
      const filled =
        o.filledPercent === null ? "" : `  ${o.filledPercent}% filled`;
      const ends =
        o.status === "Active" && o.secondsLeft !== null
          ? theme.dim(`  ends in ${humanDuration(o.secondsLeft)}`)
          : "";
      return `${o.hash}  ${statusWord(o.status, theme)}  ${pair}${filled}${ends}`;
    })
    .join("\n");
}

export { humanDuration, orderReport, parseStatuses, renderOrders, statusWord };
export type { OrderReport };
