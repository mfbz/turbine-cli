import { describe, expect, it } from "vitest";

import type { ChainReader } from "./chain.ts";
import { createFakeApi } from "./fake-api.ts";
import { planOrder } from "./order-plan.ts";
import type { OrderInput } from "./order-plan.ts";

const OWNER = "0x00000000000000000000000000000000000000aA";
const NOW = 1_800_000_000;
const ENOUGH: ChainReader = {
  balance: () => Promise.resolve(10n ** 30n),
  allowance: () => Promise.resolve(2n ** 256n - 1n),
};
const NOTHING: ChainReader = {
  balance: () => Promise.resolve(0n),
  allowance: () => Promise.resolve(0n),
};

function plan(
  input: Partial<OrderInput> = {},
  network: "playground" | "mainnet" = "playground",
  chain: ChainReader = ENOUGH
) {
  return planOrder(
    {
      amount: "1",
      sell: "WETH",
      buy: "USDC",
      spreadBps: 50,
      ttl: "1h",
      ...input,
    },
    { api: createFakeApi(), chain, owner: OWNER, network, now: () => NOW }
  );
}

describe("planning an order", () => {
  it("works out the amounts, the lifetime and the floor before anything is signed", async () => {
    const p = await plan({ limit: "2400" });
    expect(p.sellAmount).toBe(10n ** 18n);
    expect(p.atMid).toBe(2_500_000_000n);
    expect(p.atSpread).toBe(2_487_500_000n);
    expect(p.minBuyAmount).toBe(2_400_000_000n);
    expect(p.startTime).toBe(BigInt(NOW));
    expect(p.endTime).toBe(BigInt(NOW + 3600));
    expect(p.settler).toMatch(/^0x/);
    expect(p.warnings).toEqual(["REAL_FUNDS_EXPOSED"]);
  });

  it("rounds the limit floor up, so the order never accepts less than the limit", async () => {
    // 4 × 2400.0000001 = 9600.0000004 USDC: the floor must be 9600.000001, never 9600.000000.
    const p = await plan({ amount: "4", limit: "2400.0000001" });
    expect(p.minBuyAmount).toBe(9_600_000_001n);
  });

  it("warns that without a limit nothing but the spread protects the price", async () => {
    const p = await plan();
    expect(p.minBuyAmount).toBe(1n);
    expect(p.warnings).toContain("NO_LIMIT");
  });

  it("warns when the limit is above the current mid, so it won't fill yet", async () => {
    expect((await plan({ limit: "2600" })).warnings).toContain(
      "LIMIT_ABOVE_MID"
    );
  });

  it("refuses a lifetime shorter than 24 seconds and a bad limit", async () => {
    await expect(plan({ ttl: "20s" })).rejects.toMatchObject({
      code: "TTL_TOO_SHORT",
    });
    await expect(plan({ limit: "abc" })).rejects.toMatchObject({
      code: "LIMIT_INVALID",
    });
    await expect(plan({ spreadBps: 10_000 })).rejects.toMatchObject({
      code: "SPREAD_INVALID",
    });
  });

  it("refuses less than Turbine's minimum trade, valued in USDC", async () => {
    await expect(plan({ amount: "0.001" })).rejects.toMatchObject({
      code: "AMOUNT_TOO_SMALL",
    });
    await expect(
      plan({ amount: "5", sell: "USDC", buy: "WETH" })
    ).rejects.toMatchObject({ code: "AMOUNT_TOO_SMALL" });
    expect(
      (await plan({ amount: "0.001", sell: "WBTC", buy: "WETH" })).sellAmount
    ).toBe(100_000n);
  });

  it("on mainnet, refuses without the balance or the Permit2 allowance", async () => {
    await expect(
      plan({}, "mainnet", { ...ENOUGH, allowance: () => Promise.resolve(0n) })
    ).rejects.toMatchObject({ code: "ALLOWANCE_MISSING" });
    await expect(
      plan({}, "mainnet", { ...ENOUGH, balance: () => Promise.resolve(0n) })
    ).rejects.toMatchObject({ code: "BALANCE_TOO_LOW" });
  });

  it("on the playground, only warns about them, since settlement is simulated", async () => {
    const p = await plan({}, "playground", NOTHING);
    expect(p.warnings).toEqual(
      expect.arrayContaining(["ALLOWANCE_MISSING", "BALANCE_TOO_LOW"])
    );
  });

  it("on the playground, flags a wallet whose real tokens a playground signature could move", async () => {
    // Balance and Permit2 approval on Ethereum: the playground's Permit2 signature is valid there too.
    expect((await plan({}, "playground", ENOUGH)).warnings).toContain(
      "REAL_FUNDS_EXPOSED"
    );
    expect((await plan({}, "playground", NOTHING)).warnings).not.toContain(
      "REAL_FUNDS_EXPOSED"
    );
    expect((await plan({}, "mainnet", ENOUGH)).warnings).not.toContain(
      "REAL_FUNDS_EXPOSED"
    );
  });

  it("on the playground, flags a settler that isn't Turbine's: the allowance would be for it, on Ethereum", async () => {
    const other = "0x000000000000000000000000000000000000dEaD";
    const unknown = await planOrder(
      { amount: "1", sell: "WETH", buy: "USDC", spreadBps: 50, ttl: "1h" },
      {
        api: createFakeApi({ settler: other }),
        chain: NOTHING,
        owner: OWNER,
        network: "playground",
        now: () => NOW,
      }
    );
    expect(unknown.warnings).toContain("SETTLER_UNKNOWN");
    expect((await plan({}, "playground", NOTHING)).warnings).not.toContain(
      "SETTLER_UNKNOWN"
    );
  });

  it("caps an order's life at 30 days: its Permit2 allowance lives as long", async () => {
    await expect(plan({ ttl: "31d" })).rejects.toMatchObject({
      code: "TTL_TOO_LONG",
    });
    expect((await plan({ ttl: "30d" })).ttlSeconds).toBe(30 * 86_400);
  });

  it("on the playground, counts any real balance of the token as exposed, approved or not yet", async () => {
    const heldNotApproved: ChainReader = {
      balance: () => Promise.resolve(1n),
      allowance: () => Promise.resolve(0n),
    };
    expect((await plan({}, "playground", heldNotApproved)).warnings).toContain(
      "REAL_FUNDS_EXPOSED"
    );
  });

  it("on the playground, carries on if Ethereum can't be read; on mainnet, stops", async () => {
    const down: ChainReader = {
      balance: () => Promise.reject(Object.assign(new Error(), { name: "x" })),
      allowance: () => Promise.reject(new Error()),
    };
    expect((await plan({}, "playground", down)).warnings).toContain(
      "CHAIN_UNCHECKED"
    );
    await expect(plan({}, "mainnet", down)).rejects.toBeDefined();
  });
});
