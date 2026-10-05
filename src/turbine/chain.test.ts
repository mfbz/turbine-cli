import { describe, expect, it } from "vitest";

import { CliError } from "../output/errors.ts";
import { PERMIT2, approveCall, createChainReader } from "./chain.ts";

const TOKEN = "0xA0b86991c6218b36c1D19D4a2e9Eb0cE3606eB48";
const OWNER = "0x00000000000000000000000000000000000000aA";

describe("reading a token on Ethereum", () => {
  it("asks for the balance and the allowance to Permit2", async () => {
    const calls: unknown[] = [];
    const reader = createChainReader({
      readContract: (args: {
        functionName: string;
        args: readonly unknown[];
      }) => {
        calls.push(args);
        return Promise.resolve(args.functionName === "balanceOf" ? 5n : 7n);
      },
    });
    expect(await reader.balance(TOKEN, OWNER)).toBe(5n);
    expect(await reader.allowance(TOKEN, OWNER)).toBe(7n);
    expect(calls[1]).toMatchObject({
      address: TOKEN,
      functionName: "allowance",
      args: [OWNER, PERMIT2],
    });
  });

  it("reports an RPC failure in its own words", async () => {
    const reader = createChainReader({
      readContract: () =>
        Promise.reject(
          new Error("HTTP request failed. URL: https://rpc?key=SECRET")
        ),
    });
    const error = await reader.balance(TOKEN, OWNER).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).code).toBe("RPC_UNREACHABLE");
  });
});

describe("the approve transaction", () => {
  it("approves Permit2 for the token, unlimited unless an amount is given", () => {
    const call = approveCall(TOKEN);
    expect(call.to).toBe(TOKEN);
    expect(call.spender).toBe(PERMIT2);
    expect(call.amount).toBe(2n ** 256n - 1n);
    expect(call.data.startsWith("0x095ea7b3")).toBe(true);
    expect(approveCall(TOKEN, 10n).amount).toBe(10n);
  });
});
