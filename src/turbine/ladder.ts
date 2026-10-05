// A ladder: one amount split into several orders at evenly spaced spreads, the way a market maker
// quotes. Validated once for the whole amount (tokens, lifetime, limit, Ethereum checks), then split.
import { CliError } from "../output/errors.ts";
import { withSpread } from "./amounts.ts";
import { floorFor, planOrder } from "./order-plan.ts";
import type { OrderPlan } from "./order-plan.ts";

type LadderInput = {
  amount: string;
  sell: string;
  buy: string;
  levels: number;
  fromBps: number;
  toBps: number;
  ttl: string;
  limit?: string;
};
type LadderPlan = { total: OrderPlan; levels: OrderPlan[] };
type PlanDeps = Parameters<typeof planOrder>[1];

const MIN_LEVELS = 2;
const MAX_LEVELS = 20;

async function planLadder(
  input: LadderInput,
  deps: PlanDeps
): Promise<LadderPlan> {
  if (
    !Number.isInteger(input.levels) ||
    input.levels < MIN_LEVELS ||
    input.levels > MAX_LEVELS
  )
    throw new CliError("LEVELS_INVALID");
  withSpread(1n, input.fromBps);
  withSpread(1n, input.toBps);
  const total = await planOrder(
    {
      amount: input.amount,
      sell: input.sell,
      buy: input.buy,
      spreadBps: input.fromBps,
      ttl: input.ttl,
      ...(input.limit === undefined ? {} : { limit: input.limit }),
    },
    deps
  );

  const n = BigInt(input.levels);
  const part = total.sellAmount / n;
  const levels = Array.from({ length: input.levels }, (_, i): OrderPlan => {
    // The rounding remainder goes to the last level, so the ladder sells exactly the amount asked.
    const sellAmount =
      i === input.levels - 1 ? total.sellAmount - part * (n - 1n) : part;
    const exact =
      input.fromBps + ((input.toBps - input.fromBps) * i) / (input.levels - 1);
    // Halves round away from zero on both sides, so a ladder reads the same either way round.
    const spreadBps = Math.sign(exact) * Math.round(Math.abs(exact));
    const atMid =
      (sellAmount * total.quote.mid.numerator) / total.quote.mid.denominator;
    const usdcValue =
      total.usdcValue === null
        ? null
        : (total.usdcValue * sellAmount) / total.sellAmount;
    return {
      ...total,
      sellAmount,
      spreadBps,
      atMid,
      atSpread: withSpread(atMid, spreadBps),
      minBuyAmount:
        total.limit === null
          ? 1n
          : floorFor(total.limit, sellAmount, total.sell, total.buy),
      usdcValue,
    };
  });

  // Two levels at the same spread would be one order split in two, not a ladder.
  if (new Set(levels.map((l) => l.spreadBps)).size !== levels.length)
    throw new CliError("SPREADS_TOO_CLOSE");

  const smallest = levels.reduce<bigint | null>(
    (min, l) =>
      l.usdcValue === null
        ? min
        : min === null || l.usdcValue < min
          ? l.usdcValue
          : min,
    null
  );
  // Each level is its own order, so each must clear Turbine's minimum on its own.
  if (smallest !== null && smallest < (await deps.api.info()).minTradeUsdc)
    throw new CliError("LEVEL_TOO_SMALL", {
      minimum: ((await deps.api.info()).minTradeUsdc / 1_000_000n).toString(),
    });
  return { total, levels };
}

export { planLadder };
export type { LadderInput, LadderPlan };
