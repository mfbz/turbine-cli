// turbine ladder: one amount split into several orders at evenly spaced spreads, signed and sent as
// one batch. The same checks, summary, dry run and confirmations as turbine order place.
import { CliError } from "../output/errors.ts";
import type { Theme } from "../output/theme.ts";
import { formatAmount } from "../turbine/amounts.ts";
import { planLadder } from "../turbine/ladder.ts";
import type { LadderInput } from "../turbine/ladder.ts";
import type {
  SdkDeps,
  SignRequest,
  Signer,
  SubmittedMany,
} from "../turbine/sdk-orders.ts";
import type { OrderPlan } from "../turbine/order-plan.ts";
import type { Hex } from "../wallet/signer.ts";
import { confirmRealFunds, summarise } from "./place.ts";
import type { OrderSummary, PlaceDeps } from "./place.ts";

type Amount = { amount: string; atomic: string };
type Level = {
  spreadBps: number;
  sell: Amount;
  atSpreadNow: Amount;
  minBuy: Amount | null;
};
// A ladder isn't one order at one spread: the summary gives the range, and the total at today's mid.
type LadderSummary = Omit<OrderSummary, "spreadBps"> & {
  orders: number;
  spreadFromBps: number;
  spreadToBps: number;
  levels: Level[];
};
type LadderResult =
  | { dryRun: true; ladder: LadderSummary; sign: SignRequest[][] }
  | { dryRun: false; ladder: LadderSummary; hashes: Hex[] };
type LadderDeps = Omit<PlaceDeps, "submit" | "note"> & {
  note: (summary: LadderSummary) => void;
  submit: (
    plans: readonly OrderPlan[],
    signer: Signer,
    deps: SdkDeps
  ) => Promise<SubmittedMany>;
};

function amount(atomic: bigint, decimals: number): Amount {
  return { amount: formatAmount(atomic, decimals), atomic: atomic.toString() };
}

function summariseLadder(
  total: OrderPlan,
  levels: readonly OrderPlan[],
  wallet: LadderDeps["wallet"]
): LadderSummary {
  // One spread doesn't describe a ladder: the range below replaces it.
  const common: Omit<OrderSummary, "spreadBps"> & { spreadBps?: number } = {
    ...summarise(total, wallet),
  };
  delete common.spreadBps;
  const sum = levels.reduce((acc, l) => acc + l.atSpread, 0n);
  return {
    ...common,
    orders: levels.length,
    spreadFromBps: levels[0]?.spreadBps ?? total.spreadBps,
    spreadToBps: levels.at(-1)?.spreadBps ?? total.spreadBps,
    atSpreadNow: amount(sum, total.buy.decimals),
    levels: levels.map((l) => ({
      spreadBps: l.spreadBps,
      sell: amount(l.sellAmount, l.sell.decimals),
      atSpreadNow: amount(l.atSpread, l.buy.decimals),
      minBuy: l.limit === null ? null : amount(l.minBuyAmount, l.buy.decimals),
    })),
  };
}

function renderLadderSummary(s: LadderSummary, theme: Theme): string {
  const sell = s.sell.symbol;
  const buy = s.buy.symbol;
  const network =
    s.network === "mainnet"
      ? theme.warning("▲ mainnet (real funds)")
      : theme.accent("playground (simulated)");
  const rows: Array<[string, string]> = [
    ["sell", `${s.sell.amount} ${sell} in ${s.orders} orders`],
    [
      "receive",
      `at least ${s.atSpreadNow.amount} ${buy} in all at today's mid; it follows the market`,
    ],
    ["mid now", `${s.midPrice} ${buy} per ${sell}`],
    ["spreads", `${s.spreadFromBps} to ${s.spreadToBps} bps from mid`],
    [
      "limit",
      s.limit
        ? `${s.limit.price} ${buy} per ${sell} on every level`
        : theme.warning("none"),
    ],
    ["lives", `${s.lifetime.seconds} s, until ${s.lifetime.endsAt}`],
    ["fee", `${s.feePercent}%, inside the spread`],
    ["wallet", `${s.wallet.name} ${s.wallet.address}`],
  ];
  const width = Math.max(...rows.map(([label]) => label.length)) + 2;
  const amounts = Math.max(...s.levels.map((l) => l.sell.amount.length));
  return [
    `${theme.bold(`Ladder: ${s.orders} orders`)} ${theme.dim("on")} ${network}`,
    ...rows.map(
      ([label, value]) => `  ${theme.dim(label.padEnd(width))}${value}`
    ),
    "",
    ...s.levels.map(
      (l) =>
        `  ${theme.dim(`${String(l.spreadBps).padStart(6)} bps`)}  ${l.sell.amount.padStart(amounts)} ${sell} → at least ${l.atSpreadNow.amount} ${buy}${l.minBuy ? theme.dim(` (floor ${l.minBuy.amount})`) : ""}`
    ),
    "",
    `  ${theme.bold(`You sign ${s.orders * 2} things`)}, two per order:`,
    `  ${theme.dim("•")} a Permit2 allowance: ${theme.warning(`unlimited ${s.permit2.token}`)} for Turbine's settler ${s.permit2.spender}, until ${s.permit2.expiresAt}`,
    `  ${theme.dim("•")} the order itself; all ${s.orders} go to Turbine in one batch`,
    ...s.warnings.map((w) => `  ${theme.warning("▲")} ${w.message}`),
  ].join("\n");
}

function renderLadder(result: LadderResult, theme: Theme): string {
  if (result.dryRun)
    return theme.dim(
      `Dry run: nothing was signed or sent. With --json, the exact typed data for each of the ${result.ladder.orders} orders is included.`
    );
  return [
    `${theme.success("✓")} ${result.hashes.length} orders placed on ${result.ladder.network}:`,
    ...result.hashes.map((hash) => `  ${hash}`),
    theme.dim(
      "Follow one with: turbine order watch <hash>, or all with: turbine orders"
    ),
  ].join("\n");
}

async function ladderCommand(
  input: LadderInput,
  deps: LadderDeps
): Promise<LadderResult> {
  const { total, levels } = await planLadder(input, {
    api: deps.api,
    chain: deps.chain,
    owner: deps.wallet.address,
    network: deps.network.name,
    now: deps.now,
  });
  const summary = summariseLadder(total, levels, deps.wallet);
  deps.note(summary);
  const sdk: SdkDeps = { network: deps.network };
  if (deps.dryRun) {
    const result = await deps.submit(
      levels,
      { kind: "dry-run", address: deps.wallet.address },
      sdk
    );
    if (result.kind !== "dry-run") throw new CliError("INTERNAL");
    return { dryRun: true, ladder: summary, sign: result.sign };
  }
  await confirmRealFunds(total, deps, "ladder");
  const { account } = await deps.unlock();
  if (account.address.toLowerCase() !== deps.wallet.address.toLowerCase())
    throw new CliError("WALLET_ADDRESS_MISMATCH");
  const result = await deps.submit(levels, { kind: "account", account }, sdk);
  if (result.kind !== "sent") throw new CliError("INTERNAL");
  return { dryRun: false, ladder: summary, hashes: result.hashes };
}

export { ladderCommand, renderLadder, renderLadderSummary };
export type { LadderResult };
