import { describe, expect, it } from "vitest";

import type { ChainReader } from "./chain.ts";
import { createFakeApi } from "./fake-api.ts";
import { planLadder } from "./ladder.ts";
import type { LadderInput } from "./ladder.ts";

const OWNER = "0x00000000000000000000000000000000000000aA";
const EMPTY: ChainReader = {
  balance: () => Promise.resolve(0n),
  allowance: () => Promise.resolve(0n),
};

function plan(input: Partial<LadderInput> = {}) {
  return planLadder(
    {
      amount: "1",
      sell: "WETH",
      buy: "USDC",
      levels: 5,
      fromBps: -10,
      toBps: 30,
      ttl: "4h",
      ...input,
    },
    {
      api: createFakeApi(),
      chain: EMPTY,
      owner: OWNER,
      network: "playground",
      now: () => 1_800_000_000,
    }
  );
}

describe("planning a ladder", () => {
  it("splits the amount evenly and spaces the spreads from --from to --to", async () => {
    const ladder = await plan();
    expect(ladder.levels.map((l) => l.spreadBps)).toEqual([-10, 0, 10, 20, 30]);
    expect(ladder.levels.map((l) => l.sellAmount)).toEqual(
      Array.from({ length: 5 }, () => 200_000_000_000_000_000n)
    );
    expect(ladder.levels[0]?.atSpread).toBe(500_500_000n);
    expect(ladder.levels[4]?.atSpread).toBe(498_500_000n);
  });

  it("gives the rounding remainder to the last level, so nothing is lost", async () => {
    const ladder = await plan({
      amount: "100",
      sell: "USDC",
      buy: "WETH",
      levels: 3,
      fromBps: 0,
      toBps: 20,
    });
    const total = ladder.levels.reduce((sum, l) => sum + l.sellAmount, 0n);
    expect(total).toBe(100_000_000n);
    expect(ladder.levels.map((l) => l.sellAmount)).toEqual([
      33_333_333n,
      33_333_333n,
      33_333_334n,
    ]);
  }, 10_000);

  it("refuses spreads too close together to give every level its own", async () => {
    await expect(
      plan({ fromBps: 0, toBps: 1, levels: 5 })
    ).rejects.toMatchObject({
      code: "SPREADS_TOO_CLOSE",
    });
  });

  it("rounds spreads evenly on both sides of zero, and allows a descending ladder", async () => {
    expect(
      (await plan({ fromBps: -5, toBps: 0, levels: 3 })).levels.map(
        (l) => l.spreadBps
      )
    ).toEqual([-5, -3, 0]);
    expect(
      (await plan({ fromBps: 30, toBps: -10, levels: 5 })).levels.map(
        (l) => l.spreadBps
      )
    ).toEqual([30, 20, 10, 0, -10]);
  });

  it("refuses fewer than 2 or more than 20 levels", async () => {
    await expect(plan({ levels: 1 })).rejects.toMatchObject({
      code: "LEVELS_INVALID",
    });
    await expect(plan({ levels: 21 })).rejects.toMatchObject({
      code: "LEVELS_INVALID",
    });
  });

  it("refuses a ladder whose levels fall under Turbine's minimum", async () => {
    await expect(plan({ amount: "0.015", levels: 5 })).rejects.toMatchObject({
      code: "LEVEL_TOO_SMALL",
    });
  });

  it("applies one limit floor to every level, sized to each", async () => {
    const ladder = await plan({
      limit: "2400",
      levels: 2,
      fromBps: 0,
      toBps: 10,
    });
    expect(ladder.levels.map((l) => l.minBuyAmount)).toEqual([
      1_200_000_000n,
      1_200_000_000n,
    ]);
  });
});
