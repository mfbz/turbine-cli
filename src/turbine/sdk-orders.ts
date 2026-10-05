// Placing and cancelling orders through Turbine's official SDK, in signed-request (EIP-712) mode.
// For --dry-run the SDK runs its real flow with an account that records what it is asked to sign and
// never signs: it hands back a placeholder for the Permit2 allowance and stops the flow at the request
// signature, which the SDK makes just before sending. So a dry run shows exactly what would be signed,
// and nothing can be sent.
import { getRandomSalt, spreads, TurbineClient } from "turbine-sdk";
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
type SdkDeps = {
  network: NetworkConfig;
  // Test-only: the Ethereum RPC (default: TURBINE_RPC_URL or viem's public mainnet endpoint).
  transport?: Transport;
};

// A well-formed signature that signs nothing, for the Permit2 step of a dry run.
const PLACEHOLDER_SIGNATURE: Hex = `0x${"00".repeat(64)}1b`;
const STOPPING_TYPES = new Set(["AddOrder", "CancelOrder"]);
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
      if (STOPPING_TYPES.has(primary)) {
        stopped = true;
        return Promise.reject(new DryRunStop());
      }
      return Promise.resolve(PLACEHOLDER_SIGNATURE);
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

async function run(
  signer: Signer,
  deps: SdkDeps,
  settler: Hex,
  work: (client: TurbineClient) => Promise<Hex>
): Promise<Submitted> {
  if (signer.kind === "account") {
    const client = await quietly(() => connect(signer.account, deps, settler));
    return { kind: "sent", hash: await quietly(() => work(client)) };
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

async function submitOrder(
  plan: OrderPlan,
  signer: Signer,
  deps: SdkDeps
): Promise<Submitted> {
  const intent = {
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
  return run(
    signer,
    deps,
    plan.settler,
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
    async (client) => (await client.cancelOrder(hash)).orderHash as Hex
  );
}

export { submitCancel, submitOrder };
export type { SdkDeps, SignRequest, Signer, Submitted };
