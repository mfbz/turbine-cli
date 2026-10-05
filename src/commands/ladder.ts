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
import { confirmRealFunds, renderSummary, summarise } from "./place.ts";
import type { OrderSummary, PlaceDeps } from "./place.ts";

type Amount = { amount: string; atomic: string };
type Level = {
  spreadBps: number;
  sell: Amount;
  atSpreadNow: Amount;
  minBuy: Amount | null;
};
type LadderSummary = OrderSummary & { orders: number; levels: Level[] };
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
  return {
    ...summarise(total, wallet),
    orders: levels.length,
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
  const width = Math.max(...s.levels.map((l) => l.sell.amount.length));
  const rows = s.levels.map(
    (l) =>
      `  ${theme.dim(`${String(l.spreadBps).padStart(6)} bps`)}  ${l.sell.amount.padStart(width)} ${sell} → at least ${l.atSpreadNow.amount} ${buy}${l.minBuy ? theme.dim(` (floor ${l.minBuy.amount})`) : ""}`
  );
  return [
    renderSummary(s, theme).replace(/^Order/, `Ladder: ${s.orders} orders`),
    "",
    `  ${theme.bold("Levels")} ${theme.dim(`(each signs its own Permit2 allowance and order)`)}`,
    ...rows,
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
