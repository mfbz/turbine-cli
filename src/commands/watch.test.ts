import { describe, expect, it } from "vitest";

import { createTheme } from "../output/theme.ts";
import type { OrderReport } from "./orders.ts";
import { renderWatch, watchOrder } from "./watch.ts";

function report(over: Partial<OrderReport> = {}): OrderReport {
  return {
    hash: `0x${"ab".repeat(32)}`,
    status: "Active",
    sell: {
      symbol: "WETH",
      address: "0x1",
      amount: "1",
      atomic: "1000000000000000000",
    },
    buy: { symbol: "USDC", address: "0x2" },
    sold: { amount: "0", atomic: "0" },
    bought: { amount: "0", atomic: "0" },
    filledPercent: "0",
    limitPrice: "2400",
    createdAt: "2027-01-15T08:00:00.000Z",
    endsAt: "2027-01-15T09:00:00.000Z",
    secondsLeft: 3600,
    fills: [],
    ...over,
  };
}

function run(
  states: OrderReport[],
  mode: "json" | "lines" | "screen",
  keys: string[] = []
) {
  const written: string[] = [];
  const queue = [...states];
  let last = queue[0] ?? report();
  const pending = [...keys];
  return watchOrder({
    fetchState: () => Promise.resolve((last = queue.shift() ?? last)),
    fetchMid: () => Promise.resolve("2500"),
    sleep: () => Promise.resolve(),
    nextKey: () => pending.shift(),
    mode,
    write: (text) => written.push(text),
    theme: createTheme(0),
    width: () => 80,
    now: () => 0,
  }).then((outcome) => ({ outcome, written }));
}

describe("watching an order", () => {
  it("streams one JSON event per change, and a final one when the order is done", async () => {
    const { outcome, written } = await run(
      [
        report(),
        report(),
        report({ filledPercent: "40" }),
        report({ status: "Filled", filledPercent: "100" }),
      ],
      "json"
    );
    const events = written
      .join("")
      .trim()
      .split("\n")
      .map(
        (line) =>
          JSON.parse(line) as {
            type: string;
            order: { status: string; filledPercent: string };
            mid: string;
          }
      );
    expect(events.map((e) => e.type)).toEqual(["state", "state", "final"]);
    expect(events[1]?.order.filledPercent).toBe("40");
    expect(events[0]?.mid).toBe("2500");
    expect(outcome).toEqual({ kind: "done", status: "Filled" });
  });

  it("writes one plain line per change when piped", async () => {
    const { written } = await run(
      [report(), report(), report({ status: "Expired" })],
      "lines"
    );
    expect(written).toHaveLength(2);
    expect(written[0]).toMatch(/active .*0% filled.*mid 2500/);
    expect(written[1]).toContain("expired");
  });

  it("stops on q, and asks for a cancel on c, in the full-screen view", async () => {
    expect((await run([report(), report()], "screen", ["q"])).outcome).toEqual({
      kind: "quit",
    });
    expect((await run([report(), report()], "screen", ["c"])).outcome).toEqual({
      kind: "cancel",
    });
  });
});

describe("the live view", () => {
  it("shows the status, a fill bar, mid against the limit, and the time left", () => {
    const text = renderWatch(
      report({
        filledPercent: "40",
        sold: { amount: "0.4", atomic: "4" },
        bought: { amount: "1000", atomic: "1" },
        fills: [
          {
            txHash: "0x11",
            clearedAt: "2027-01-15T08:10:00.000Z",
            sold: { amount: "0.4", atomic: "4" },
            bought: { amount: "1000", atomic: "1" },
            price: "2500",
          },
        ],
      }),
      "2510",
      createTheme(0),
      80,
      0
    );
    for (const piece of [
      "active",
      "40%",
      "█",
      "mid 2510",
      "limit 2400",
      "0.4 WETH sold for 1000 USDC",
      "1h 0m left",
      "q quit",
      "c cancel",
    ])
      expect(text).toContain(piece);
    for (const line of text.split("\n"))
      expect([...line].length).toBeLessThanOrEqual(80);
  });
});
