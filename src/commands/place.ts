// turbine order place: plan, show exactly what will be signed, then (only after --dry-run stops or a
// confirmation passes) unlock the wallet and submit through the SDK.
import type { NetworkConfig } from "../config/network.ts";
import { CliError } from "../output/errors.ts";
import type { Theme } from "../output/theme.ts";
import { formatAmount, priceOf } from "../turbine/amounts.ts";
import type { TurbineApi } from "../turbine/api.ts";
import type { ChainReader } from "../turbine/chain.ts";
import { planOrder } from "../turbine/order-plan.ts";
import type { OrderInput, OrderPlan, Warning } from "../turbine/order-plan.ts";
import type {
  SdkDeps,
  SignRequest,
  Signer,
  Submitted,
} from "../turbine/sdk-orders.ts";
import type { Hex, Unlocked } from "../wallet/signer.ts";

type Amount = { amount: string; atomic: string };
type OrderSummary = {
  network: NetworkConfig["name"];
  wallet: { name: string; address: Hex };
  sell: { symbol: string; address: Hex } & Amount;
  buy: { symbol: string; address: Hex };
  midPrice: string;
  atMid: Amount;
  spreadBps: number;
  // At today's mid price: the order tracks the mid, so only the limit is a hard floor.
  atSpreadNow: Amount;
  limit: { price: string; minBuy: Amount } | null;
  lifetime: { seconds: number; endsAt: string };
  feePercent: string;
  permit2: {
    token: string;
    spender: Hex;
    amount: "unlimited";
    expiresAt: string;
  };
  warnings: { code: Warning; message: string }[];
};
type PlaceResult =
  | { dryRun: true; order: OrderSummary; sign: SignRequest[] }
  | { dryRun: false; order: OrderSummary; hash: Hex };
type PlaceDeps = {
  api: TurbineApi;
  chain: ChainReader;
  network: NetworkConfig;
  wallet: { name: string; address: Hex };
  dryRun: boolean;
  yes: boolean;
  interactive: boolean;
  now: () => number;
  // Shown before anything else happens: on stderr for a person (stdout stays the result).
  note: (summary: OrderSummary) => void;
  confirm: (message: string) => Promise<boolean | undefined>;
  unlock: () => Promise<Unlocked>;
  submit: (
    plan: OrderPlan,
    signer: Signer,
    deps: SdkDeps
  ) => Promise<Submitted>;
};

const WARNINGS: Record<Warning, string> = {
  NO_LIMIT:
    "No limit: if the market moves, this order trades at whatever mid minus your spread is. Add --limit to set a floor.",
  LIMIT_ABOVE_MID:
    "Your limit is above the current mid price, so the order won't fill until the price rises to it.",
  ALLOWANCE_MISSING:
    "Permit2 isn't approved for this token on Ethereum. The playground may still simulate it; mainnet won't (turbine approve).",
  BALANCE_TOO_LOW:
    "This wallet doesn't hold this amount on Ethereum. The playground may still simulate it; mainnet won't.",
  CHAIN_UNCHECKED:
    "Couldn't read the wallet's balance and allowance from Ethereum; the playground will tell.",
  REAL_FUNDS_EXPOSED:
    "This wallet holds real tokens of this kind on Ethereum, and the playground's Permit2 signature is valid there too until the order ends. Use a fresh wallet for the playground (turbine wallet new).",
};

function amount(atomic: bigint, decimals: number): Amount {
  return { amount: formatAmount(atomic, decimals), atomic: atomic.toString() };
}

function iso(seconds: bigint): string {
  return new Date(Number(seconds) * 1000).toISOString();
}

function summarise(plan: OrderPlan, wallet: PlaceDeps["wallet"]): OrderSummary {
  const buy = plan.buy.decimals;
  return {
    network: plan.network,
    wallet,
    sell: {
      symbol: plan.sell.symbol,
      address: plan.sell.address,
      ...amount(plan.sellAmount, plan.sell.decimals),
    },
    buy: { symbol: plan.buy.symbol, address: plan.buy.address },
    midPrice: priceOf(plan.quote.mid, plan.sell.decimals, buy, 18),
    atMid: amount(plan.atMid, buy),
    spreadBps: plan.spreadBps,
    atSpreadNow: amount(plan.atSpread, buy),
    limit:
      plan.limit === null
        ? null
        : { price: plan.limit, minBuy: amount(plan.minBuyAmount, buy) },
    lifetime: { seconds: plan.ttlSeconds, endsAt: iso(plan.endTime) },
    feePercent: formatAmount(BigInt(plan.quote.feeHbp), 4),
    permit2: {
      token: plan.sell.symbol,
      spender: plan.settler,
      amount: "unlimited",
      expiresAt: iso(plan.endTime),
    },
    warnings: plan.warnings.map((code) => ({ code, message: WARNINGS[code] })),
  };
}

function renderSummary(s: OrderSummary, theme: Theme): string {
  const buy = s.buy.symbol;
  const sell = s.sell.symbol;
  const network =
    s.network === "mainnet"
      ? theme.warning("▲ mainnet (real funds)")
      : theme.accent("playground (simulated)");
  const rows: Array<[string, string]> = [
    ["sell", `${s.sell.amount} ${sell}`],
    [
      "receive",
      `at least ${s.atSpreadNow.amount} ${buy} at today's mid; it follows the market`,
    ],
    [
      "mid now",
      `${s.midPrice} ${buy} per ${sell} (${s.atMid.amount} ${buy} at mid)`,
    ],
    ["spread", `${s.spreadBps} bps from mid`],
    [
      "limit",
      s.limit
        ? `${s.limit.price} ${buy} per ${sell}: never less than ${s.limit.minBuy.amount} ${buy}`
        : theme.warning("none"),
    ],
    ["lives", `${s.lifetime.seconds} s, until ${s.lifetime.endsAt}`],
    ["fee", `${s.feePercent}%, inside the spread`],
    ["wallet", `${s.wallet.name} ${s.wallet.address}`],
  ];
  const width = Math.max(...rows.map(([label]) => label.length)) + 2;
  return [
    `${theme.bold("Order")} ${theme.dim("on")} ${network}`,
    ...rows.map(
      ([label, value]) => `  ${theme.dim(label.padEnd(width))}${value}`
    ),
    "",
    `  ${theme.bold("You sign")} two things:`,
    `  ${theme.dim("1.")} a Permit2 allowance: ${theme.warning(`unlimited ${s.permit2.token}`)} for Turbine's settler ${s.permit2.spender}, until ${s.permit2.expiresAt}`,
    `  ${theme.dim("2.")} the order itself, sent to Turbine`,
    ...s.warnings.map((w) => `  ${theme.warning("▲")} ${w.message}`),
  ].join("\n");
}

function renderPlaced(result: PlaceResult, theme: Theme): string {
  if (result.dryRun)
    return `${theme.dim("Dry run: nothing was signed or sent.")} ${theme.dim(
      "With --json, the exact typed data the wallet would sign is included."
    )}`;
  return [
    `${theme.success("✓")} Order placed on ${result.order.network}: ${result.hash}`,
    theme.dim(`Follow it with: turbine order watch ${result.hash}`),
  ].join("\n");
}

/** Mainnet, or a playground order that could expose real tokens: ask, or require --yes. */
async function confirmRealFunds(
  plan: OrderPlan,
  deps: Pick<PlaceDeps, "network" | "interactive" | "yes" | "confirm">,
  what: "order" | "ladder"
): Promise<void> {
  // Couldn't check counts as exposed: the signature is real either way.
  const realFunds =
    deps.network.name === "mainnet" ||
    plan.warnings.includes("REAL_FUNDS_EXPOSED") ||
    plan.warnings.includes("CHAIN_UNCHECKED");
  if (!realFunds) return;
  if (deps.interactive) {
    const sure = await deps.confirm(
      deps.network.name === "mainnet"
        ? `Sign and place this ${what} on mainnet, with real funds?`
        : "Sign anyway? The allowance could move this wallet's real tokens."
    );
    if (sure !== true) throw new CliError("CANCELLED");
  } else if (!deps.yes) {
    throw new CliError("CONFIRMATION_REQUIRED");
  }
}

async function placeCommand(
  input: OrderInput,
  deps: PlaceDeps
): Promise<PlaceResult> {
  const plan = await planOrder(input, {
    api: deps.api,
    chain: deps.chain,
    owner: deps.wallet.address,
    network: deps.network.name,
    now: deps.now,
  });
  const summary = summarise(plan, deps.wallet);
  deps.note(summary);
  const sdk: SdkDeps = { network: deps.network };

  if (deps.dryRun) {
    const result = await deps.submit(
      plan,
      { kind: "dry-run", address: deps.wallet.address },
      sdk
    );
    if (result.kind !== "dry-run") throw new CliError("INTERNAL");
    return { dryRun: true, order: summary, sign: result.sign };
  }

  // Real funds: mainnet, or a playground order whose allowance could move this wallet's real tokens.
  await confirmRealFunds(plan, deps, "order");

  const { account } = await deps.unlock();
  if (account.address.toLowerCase() !== deps.wallet.address.toLowerCase())
    throw new CliError("WALLET_ADDRESS_MISMATCH");
  const result = await deps.submit(plan, { kind: "account", account }, sdk);
  if (result.kind !== "sent") throw new CliError("INTERNAL");
  return { dryRun: false, order: summary, hash: result.hash };
}

export {
  confirmRealFunds,
  placeCommand,
  renderPlaced,
  renderSummary,
  summarise,
};
export type { OrderSummary, PlaceDeps, PlaceResult };
