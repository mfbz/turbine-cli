// Placing and cancelling orders through Turbine's official SDK, in signed-request (EIP-712) mode.
// For --dry-run the SDK runs its real flow with an account that records what it is asked to sign and
// never signs: it hands back a placeholder for the Permit2 allowance and stops the flow at the request
// signature, which the SDK makes just before sending. So a dry run shows exactly what would be signed,
// and nothing can be sent.
import { getRandomSalt, spreads, TurbineClient } from "turbine-sdk";
import type { GetOrdersOptions, OrderState } from "turbine-sdk";
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  zeroAddress,
} from "viem";
import type { Account, Transport } from "viem";
import { toAccount } from "viem/accounts";
import { mainnet } from "viem/chains";

import type { NetworkConfig } from "../config/network.ts";
import { CliError } from "../output/errors.ts";
import type { Hex } from "../wallet/signer.ts";
import type { OrderPlan } from "./order-plan.ts";

type SignRequest = {
  // What the signature is for, in words a person can check.
  purpose: "permit2-allowance" | "order" | "cancel";
  typedData: unknown;
};
type Signer =
  { kind: "account"; account: Account } | { kind: "dry-run"; address: Hex };
type Submitted =
  { kind: "sent"; hash: Hex } | { kind: "dry-run"; sign: SignRequest[] };
type SubmittedMany =
  { kind: "sent"; hashes: Hex[] } | { kind: "dry-run"; sign: SignRequest[][] };
type SdkDeps = {
  network: NetworkConfig;
  // Test-only: the Ethereum RPC (default: TURBINE_RPC_URL or viem's public mainnet endpoint).
  transport?: Transport;
};

// A well-formed signature that signs nothing, for the Permit2 step of a dry run.
const PLACEHOLDER_SIGNATURE: Hex = `0x${"00".repeat(64)}1b`;
// The only signature a dry run answers (with a placeholder); anything else ends it before sending.
const PERMIT_TYPE = "PermitSingle";
const PURPOSE: Record<string, SignRequest["purpose"]> = {
  PermitSingle: "permit2-allowance",
  AddOrder: "order",
  CancelOrder: "cancel",
};

class DryRunStop extends Error {
  constructor() {
    super("dry run: stopped before signing the request");
    this.name = "DryRunStop";
  }
}

// bigints become strings, so a captured request can be printed as JSON.
function plainData(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, v: unknown) =>
      typeof v === "bigint" ? v.toString() : v
    )
  ) as unknown;
}

function recorder(address: Hex) {
  const sign: SignRequest[] = [];
  let stopped = false;
  const refuse = () => Promise.reject(new DryRunStop());
  const account = toAccount({
    address,
    signMessage: refuse,
    signTransaction: refuse,
    signTypedData(typedData) {
      const primary = String(typedData.primaryType);
      sign.push({
        purpose: PURPOSE[primary] ?? "order",
        typedData: plainData(typedData),
      });
      if (primary === PERMIT_TYPE)
        return Promise.resolve(PLACEHOLDER_SIGNATURE);
      stopped = true;
      return Promise.reject(new DryRunStop());
    },
  });
  return { account, sign, stopped: () => stopped };
}

// The SDK logs some errors to the console itself; stdout must stay ours (one --json document).
async function quietly<T>(work: () => Promise<T>): Promise<T> {
  const saved = { log: console.log, error: console.error, warn: console.warn };
  const silent = () => undefined;
  Object.assign(console, { log: silent, error: silent, warn: silent });
  try {
    return await work();
  } finally {
    Object.assign(console, saved);
  }
}

async function connect(account: Account, deps: SdkDeps, settler: Hex) {
  const transport = deps.transport ?? http(deps.network.rpcUrl);
  const walletClient = createWalletClient({
    account,
    chain: mainnet,
    transport,
  });
  const publicClient = createPublicClient({ chain: mainnet, transport });
  const client = await TurbineClient.create(walletClient, publicClient, {
    turbineApiUrl: deps.network.apiUrl,
    authMethod: "eip712",
  });
  // The SDK reads the config again; it must name the same settler turbine-cli checked and showed.
  if (
    getAddress(client.getConfig().turbineSettlerAddress) !== getAddress(settler)
  )
    throw new CliError("API_CONTRACTS_UNEXPECTED");
  return client;
}

// The real account, watched: once the request itself is signed, the SDK sends it next. A failure
// from then on may mean it went through, so it must never read as "rejected" or "try again".
function watched(account: Account) {
  let requestSigned = false;
  const sign = account.signTypedData?.bind(account);
  const signMessage = account.signMessage?.bind(account);
  const signTransaction = account.signTransaction?.bind(account);
  if (!sign || !signMessage || !signTransaction) throw new CliError("INTERNAL");
  return {
    account: toAccount({
      address: account.address,
      signMessage,
      signTransaction,
      async signTypedData(typedData) {
        const signature = await sign(typedData);
        if (String(typedData.primaryType) !== PERMIT_TYPE) requestSigned = true;
        return signature;
      },
    }),
    requestSigned: () => requestSigned,
  };
}

async function run(
  signer: Signer,
  deps: SdkDeps,
  settler: Hex,
  unknownOutcome: "ORDER_OUTCOME_UNKNOWN" | "CANCEL_OUTCOME_UNKNOWN",
  work: (client: TurbineClient) => Promise<Hex>
): Promise<Submitted> {
  if (signer.kind === "account") {
    const watch = watched(signer.account);
    const client = await quietly(() => connect(watch.account, deps, settler));
    try {
      return { kind: "sent", hash: await quietly(() => work(client)) };
    } catch (error) {
      if (watch.requestSigned())
        throw new CliError(unknownOutcome, {}, { cause: error });
      throw error;
    }
  }
  const recording = recorder(signer.address);
  try {
    const client = await quietly(() =>
      connect(recording.account, deps, settler)
    );
    await quietly(() => work(client));
  } catch (error) {
    // The SDK wraps errors, so the stop is recognised by what happened, not by the error it became.
    if (recording.stopped()) return { kind: "dry-run", sign: recording.sign };
    throw error;
  }
  // Unreachable in practice: the request signature always comes before sending.
  throw new CliError("INTERNAL");
}

function intentOf(plan: OrderPlan) {
  return {
    owner: plan.owner,
    sellToken: plan.sell.address,
    buyToken: plan.buy.address,
    sellAmount: plan.sellAmount,
    minBuyAmount: plan.minBuyAmount,
    spreadCurve: spreads.constant(plan.spreadBps),
    startTime: plan.startTime,
    endTime: plan.endTime,
    // Turbine fills orders in parts as liquidity comes; whole-only orders aren't supported.
    partialFill: true,
    callData: "0x" as Hex,
    callDataTarget: zeroAddress,
    salt: getRandomSalt(),
  };
}

/** Several orders in one signed batch (a ladder); a dry run captures each order's signatures. */
async function submitOrders(
  plans: readonly OrderPlan[],
  signer: Signer,
  deps: SdkDeps
): Promise<SubmittedMany> {
  const [first] = plans;
  if (!first) throw new CliError("INTERNAL");
  if (signer.kind === "dry-run") {
    const sign: SignRequest[][] = [];
    for (const plan of plans) {
      const result = await submitOrder(plan, signer, deps);
      if (result.kind !== "dry-run") throw new CliError("INTERNAL");
      sign.push(result.sign);
    }
    return { kind: "dry-run", sign };
  }
  const watch = watched(signer.account);
  const client = await quietly(() =>
    connect(watch.account, deps, first.settler)
  );
  try {
    const hashes = await quietly(() => client.addOrders(plans.map(intentOf)));
    // One hash per order sent: anything else means some may not have been taken.
    if (hashes.length !== plans.length)
      throw new CliError("ORDER_OUTCOME_UNKNOWN");
    return { kind: "sent", hashes: hashes as Hex[] };
  } catch (error) {
    if (watch.requestSigned())
      throw new CliError("ORDER_OUTCOME_UNKNOWN", {}, { cause: error });
    throw error;
  }
}

async function submitOrder(
  plan: OrderPlan,
  signer: Signer,
  deps: SdkDeps
): Promise<Submitted> {
  const intent = intentOf(plan);
  return run(
    signer,
    deps,
    plan.settler,
    "ORDER_OUTCOME_UNKNOWN",
    async (client) => (await client.addOrder(intent)) as Hex
  );
}

async function submitCancel(
  hash: Hex,
  settler: Hex,
  signer: Signer,
  deps: SdkDeps
): Promise<Submitted> {
  return run(
    signer,
    deps,
    settler,
    "CANCEL_OUTCOME_UNKNOWN",
    async (client) => (await client.cancelOrder(hash)).orderHash as Hex
  );
}

/** The wallet's orders. In signed-request mode even reading them is a signed query, so it needs the key. */
async function listOrders(
  account: Account,
  settler: Hex,
  query: GetOrdersOptions,
  deps: SdkDeps
): Promise<OrderState[]> {
  const client = await quietly(() => connect(account, deps, settler));
  const { orders } = await quietly(() => client.getOrders(query));
  return orders;
}

/** Reads the wallet's orders again and again over one connection, so the SDK's caches keep working. */
function openOrderReader(account: Account, settler: Hex, deps: SdkDeps) {
  let client: Promise<TurbineClient> | undefined;
  return {
    async list(query: GetOrdersOptions): Promise<OrderState[]> {
      const connecting = (client ??= quietly(() =>
        connect(account, deps, settler)
      ));
      // A failed connection isn't kept: the next poll tries again.
      connecting.catch(() => {
        if (client === connecting) client = undefined;
      });
      const connected = await connecting;
      const { orders } = await quietly(() => connected.getOrders(query));
      return orders;
    },
  };
}

export { listOrders, openOrderReader, submitCancel, submitOrder, submitOrders };
export type { SdkDeps, SignRequest, Signer, Submitted, SubmittedMany };
