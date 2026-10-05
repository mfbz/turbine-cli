import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { NetworkConfig } from "../src/config/network.ts";
import { createChain } from "../src/turbine/chain.ts";
import { createHttpApi } from "../src/turbine/http.ts";
import { planOrder } from "../src/turbine/order-plan.ts";
import {
  listOrders,
  submitCancel,
  submitOrder,
} from "../src/turbine/sdk-orders.ts";
import { startMockTurbine } from "./mock-turbine.ts";
import type { MockTurbine } from "./mock-turbine.ts";

let clock = Date.now();
let mock: MockTurbine;
let network: NetworkConfig;

beforeEach(async () => {
  clock = Date.now();
  mock = await startMockTurbine({ port: 0, now: () => clock });
  network = {
    name: "playground",
    apiUrl: mock.apiUrl,
    chainId: 1,
    rpcUrl: mock.rpcUrl,
  };
});
afterEach(() => mock.close());

async function place(
  account: ReturnType<typeof privateKeyToAccount>,
  spreadBps: number
) {
  const plan = await planOrder(
    { amount: "1", sell: "WETH", buy: "USDC", spreadBps, ttl: "1h" },
    {
      api: createHttpApi({ network }),
      chain: createChain({ rpcUrl: network.rpcUrl }).reader,
      owner: account.address,
      network: "playground",
      now: () => Math.floor(clock / 1000),
    }
  );
  const sent = await submitOrder(
    plan,
    { kind: "account", account },
    { network }
  );
  if (sent.kind !== "sent") throw new Error("not sent");
  return { plan, hash: sent.hash };
}

const mine = async (account: ReturnType<typeof privateKeyToAccount>) =>
  listOrders(account, mock.settler, {}, { network });

describe("the local mock of Turbine", () => {
  it("serves the public API: tokens and a quote near the demo prices", async () => {
    const api = createHttpApi({ network });
    const info = await api.info();
    expect(info.tokens.map((t) => t.symbol)).toEqual(
      expect.arrayContaining(["WETH", "USDC", "WBTC"])
    );
    const weth = info.tokens.find((t) => t.symbol === "WETH");
    const usdc = info.tokens.find((t) => t.symbol === "USDC");
    if (!weth || !usdc) throw new Error("tokens missing");
    const quote = await api.quote(weth.address, usdc.address, 10n ** 18n);
    const usdcPerWeth = Number(quote.buyAmount + quote.feeAmount) / 1e6;
    expect(usdcPerWeth).toBeGreaterThan(2400);
    expect(usdcPerWeth).toBeLessThan(2600);
  });

  it("answers the chain checks: no balance, Permit2 already approved", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const { plan } = await place(account, 20);
    expect(plan.warnings).toContain("BALANCE_TOO_LOW");
    for (const absent of [
      "CHAIN_UNCHECKED",
      "ALLOWANCE_MISSING",
      "REAL_FUNDS_EXPOSED",
    ])
      expect(plan.warnings).not.toContain(absent);
  });

  it("takes a signed order through the real SDK and fills it over time", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const { plan, hash } = await place(account, 20);
    const [placed] = await mine(account);
    expect(placed?.hash).toBe(hash);
    expect(placed?.status).toBe("Active");
    expect(placed?.executedSellAmount).toBe(0n);

    clock += 60_000;
    const [filled] = await mine(account);
    expect(filled?.status).toBe("Filled");
    expect(filled?.executedSellAmount).toBe(plan.sellAmount);
    expect(filled?.execution.length).toBeGreaterThan(1);
    // Each fill's time comes back through the RPC's block timestamps.
    for (const fill of filled?.execution ?? []) {
      expect(fill.clearedAt.getTime()).toBeGreaterThan(clock - 120_000);
      expect(fill.clearedAt.getTime()).toBeLessThanOrEqual(clock);
    }
  });

  it("leaves an order better than mid waiting, and cancels it after the Speedbump", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const { hash } = await place(account, -10);
    clock += 60_000;
    expect((await mine(account))[0]?.status).toBe("Active");

    await submitCancel(
      hash,
      mock.settler,
      { kind: "account", account },
      {
        network,
      }
    );
    expect((await mine(account))[0]?.status).toBe("PendingCancellation");
    clock += 15_000;
    expect((await mine(account))[0]?.status).toBe("Canceled");
  });

  it("shows each wallet only its own orders", async () => {
    const one = privateKeyToAccount(generatePrivateKey());
    const other = privateKeyToAccount(generatePrivateKey());
    await place(one, 20);
    expect(await mine(other)).toEqual([]);
  });
});
