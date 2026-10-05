// Everything about an order that can be checked and computed before anything is signed: amounts,
// lifetime, spread, the price floor, Turbine's minimum trade, and (on Ethereum) the balance and the
// Permit2 allowance. Nothing here signs or sends.
import type { NetworkName } from "../config/network.ts";
import { CliError } from "../output/errors.ts";
import type { Hex } from "../wallet/signer.ts";
import {
  checkAmountFormat,
  parseAmount,
  parseDuration,
  withSpread,
} from "./amounts.ts";
import type { Quote, Token, TurbineApi } from "./api.ts";
import type { ChainReader } from "./chain.ts";
import { resolvePair } from "./tokens.ts";

type OrderInput = {
  amount: string;
  sell: string;
  buy: string;
  spreadBps: number;
  ttl: string;
  limit?: string;
};
type Warning =
  | "NO_LIMIT"
  | "LIMIT_ABOVE_MID"
  | "ALLOWANCE_MISSING"
  | "BALANCE_TOO_LOW"
  | "CHAIN_UNCHECKED"
  // Playground only: the wallet holds this token on Ethereum and Permit2 may move it. The playground's
  // Permit2 signature is a real one, valid on Ethereum too.
  | "REAL_FUNDS_EXPOSED";
type OrderPlan = {
  network: NetworkName;
  owner: Hex;
  sell: Token;
  buy: Token;
  sellAmount: bigint;
  spreadBps: number;
  limit: string | null;
  minBuyAmount: bigint;
  startTime: bigint;
  endTime: bigint;
  ttlSeconds: number;
  quote: Quote;
  atMid: bigint;
  atSpread: bigint;
  settler: Hex;
  warnings: Warning[];
};
type PlanDeps = {
  api: TurbineApi;
  chain: ChainReader;
  owner: Hex;
  network: NetworkName;
  now: () => number;
};

// Turbine's Speedbump is about 12 s; its docs recommend at least two blocks.
const MIN_TTL_SECONDS = 24;
// An order's Permit2 allowance lasts as long as the order, so neither may last too long.
const MAX_TTL_SECONDS = 30 * 86_400;
const DECIMAL = /^(\d+)(?:\.(\d+))?$/;

/** minBuyAmount for a limit price (buy tokens per sell token), rounded up: never below the limit. */
function floorFor(
  limit: string,
  sellAmount: bigint,
  sell: Token,
  buy: Token
): bigint {
  const match = DECIMAL.exec(limit.trim());
  if (!match) throw new CliError("LIMIT_INVALID");
  const fraction = match[2] ?? "";
  const price = BigInt(`${match[1] ?? "0"}${fraction}`);
  if (price === 0n) throw new CliError("LIMIT_INVALID");
  const numerator = sellAmount * price * 10n ** BigInt(buy.decimals);
  const denominator = 10n ** BigInt(fraction.length + sell.decimals);
  return (numerator + denominator - 1n) / denominator;
}

async function usdcValue(
  api: TurbineApi,
  tokens: readonly Token[],
  sell: Token,
  buy: Token,
  sellAmount: bigint,
  atMid: bigint
): Promise<bigint | null> {
  const usdc = tokens.find((t) => t.symbol.toUpperCase() === "USDC");
  if (!usdc) return null;
  if (sell.address === usdc.address) return sellAmount;
  if (buy.address === usdc.address) return atMid;
  const quote = await api.quote(sell.address, usdc.address, sellAmount);
  return (sellAmount * quote.mid.numerator) / quote.mid.denominator;
}

async function checkChain(
  plan: Pick<OrderPlan, "network" | "sell" | "sellAmount" | "owner">,
  chain: ChainReader,
  warnings: Warning[]
): Promise<void> {
  const mainnet = plan.network === "mainnet";
  let balance: bigint;
  let allowance: bigint;
  try {
    [balance, allowance] = await Promise.all([
      chain.balance(plan.sell.address, plan.owner),
      chain.allowance(plan.sell.address, plan.owner),
    ]);
  } catch (error) {
    // Real funds need these checks; on the playground settlement is simulated, so carry on.
    if (mainnet) throw error;
    warnings.push("CHAIN_UNCHECKED");
    return;
  }
  const token = plan.sell.symbol;
  // Any balance counts, approved or not: the allowance signature stays valid until the order ends,
  // so an approval made later would bring it to life.
  if (!mainnet && balance > 0n) warnings.push("REAL_FUNDS_EXPOSED");
  if (allowance < plan.sellAmount) {
    if (mainnet) throw new CliError("ALLOWANCE_MISSING", { token });
    warnings.push("ALLOWANCE_MISSING");
  }
  if (balance < plan.sellAmount) {
    if (mainnet) throw new CliError("BALANCE_TOO_LOW", { token });
    warnings.push("BALANCE_TOO_LOW");
  }
}

async function planOrder(
  input: OrderInput,
  deps: PlanDeps
): Promise<OrderPlan> {
  // Everything that needs no network first, so a typo is a usage error even offline.
  checkAmountFormat(input.amount);
  withSpread(1n, input.spreadBps);
  const ttlSeconds = parseDuration(input.ttl);
  if (ttlSeconds < MIN_TTL_SECONDS) throw new CliError("TTL_TOO_SHORT");
  if (ttlSeconds > MAX_TTL_SECONDS) throw new CliError("TTL_TOO_LONG");
  if (input.limit !== undefined && !DECIMAL.test(input.limit.trim()))
    throw new CliError("LIMIT_INVALID");

  const info = await deps.api.info();
  const { sell, buy } = resolvePair(input.sell, input.buy, info.tokens);
  const sellAmount = parseAmount(input.amount, sell.decimals);
  const quote = await deps.api.quote(sell.address, buy.address, sellAmount);
  const atMid = (sellAmount * quote.mid.numerator) / quote.mid.denominator;
  const atSpread = withSpread(atMid, input.spreadBps);

  const value = await usdcValue(
    deps.api,
    info.tokens,
    sell,
    buy,
    sellAmount,
    atMid
  );
  if (value !== null && value < info.minTradeUsdc)
    throw new CliError("AMOUNT_TOO_SMALL", {
      minimum: (info.minTradeUsdc / 1_000_000n).toString(),
    });

  const warnings: Warning[] = [];
  let minBuyAmount = 1n;
  if (input.limit === undefined) warnings.push("NO_LIMIT");
  else {
    minBuyAmount = floorFor(input.limit, sellAmount, sell, buy);
    if (minBuyAmount > atMid) warnings.push("LIMIT_ABOVE_MID");
  }

  const startTime = BigInt(deps.now());
  const plan: OrderPlan = {
    network: deps.network,
    owner: deps.owner,
    sell,
    buy,
    sellAmount,
    spreadBps: input.spreadBps,
    limit: input.limit?.trim() ?? null,
    minBuyAmount,
    startTime,
    endTime: startTime + BigInt(ttlSeconds),
    ttlSeconds,
    quote,
    atMid,
    atSpread,
    settler: info.settler,
    warnings,
  };
  await checkChain(plan, deps.chain, warnings);
  return plan;
}

export { planOrder };
export type { OrderInput, OrderPlan, Warning };
