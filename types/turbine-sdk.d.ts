// Types for the part of Turbine's SDK (github.com/propeller-heads/turbine-sdk, pinned in package.json)
// that turbine-cli uses. The SDK ships raw TypeScript written for looser compiler settings than this
// repo's, so `tsc` reads these declarations instead of its sources (tsconfig.check.json "paths"); the
// bundler and the tests use the SDK itself, and src/turbine/sdk-orders.test.ts checks the behaviour.
declare module "turbine-sdk" {
  import type { Address, Hex, PublicClient, WalletClient } from "viem";

  type AuthMethod = "siwe" | "eip712";
  type SpreadCurve = {
    startDeltaBps: number;
    endDeltaBps: number;
    points: { windowBps: number; deltaBps: number }[];
  };
  type OrderIntent = {
    owner: Address;
    sellToken: Address;
    buyToken: Address;
    sellAmount: bigint;
    minBuyAmount: bigint;
    spreadCurve: SpreadCurve;
    startTime: bigint;
    endTime: bigint;
    partialFill: boolean;
    callData: Hex;
    callDataTarget: Address;
    salt: Hex;
  };
  type Price = { numerator: bigint; denominator: bigint };
  type OrderExecution = {
    txHash: Hex;
    clearedAt: Date;
    soldAmount: bigint;
    boughtAmount: bigint;
    surplusBoughtAmount: bigint;
    midPrice?: Price;
  };
  type OrderDetails = {
    sellToken: Address;
    buyToken: Address;
    sellAmount: bigint;
    limitPrice: Price;
    startTime: bigint;
    endTime: bigint;
    createdTimestamp: Date;
  };
  type OrderStatus =
    | "Active"
    | "Filled"
    | "Expired"
    | "Canceled"
    | "PendingCancellation"
    | "Invalid"
    | "Incompatible";
  type OrderState = {
    hash: Hex;
    status: string;
    execution: OrderExecution[];
    executedSellAmount: bigint;
    executedBuyAmount: bigint;
    orderDetails?: OrderDetails;
  };
  type GetOrdersOptions = {
    hashes?: Hex[];
    statuses?: OrderStatus[];
    cursor?: string;
    limit?: number;
  };
  type GetOrdersResponse = {
    orders: OrderState[];
    cursor: string | null;
    hasMore: boolean;
  };
  type TurbineConfig = { turbineSettlerAddress: Address };

  class TurbineClient {
    static create(
      walletClient: WalletClient,
      publicClient: PublicClient,
      options?: { turbineApiUrl?: string; authMethod?: AuthMethod }
    ): Promise<TurbineClient>;
    addOrder(intent: OrderIntent): Promise<string>;
    addOrders(intents: OrderIntent[]): Promise<string[]>;
    cancelOrder(orderHash: Hex): Promise<{ orderHash: string }>;
    getOrders(options?: GetOrdersOptions): Promise<GetOrdersResponse>;
    getConfig(): TurbineConfig;
  }

  function getRandomSalt(): Hex;
  function fetchConfig(url: string): Promise<TurbineConfig>;
  const spreads: { constant(deltaBps: number): SpreadCurve };

  export { fetchConfig, getRandomSalt, spreads, TurbineClient };
  export type {
    GetOrdersOptions,
    GetOrdersResponse,
    OrderExecution,
    OrderIntent,
    OrderState,
    OrderStatus,
  };
}
