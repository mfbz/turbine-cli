import { describe, expect, it } from "vitest";

import { CliError } from "../output/errors.ts";
import { readEnv } from "./env.ts";

function thrown(fn: () => unknown): CliError {
  try {
    fn();
  } catch (error) {
    if (error instanceof CliError) return error;
    throw error;
  }
  throw new Error("expected a CliError");
}

describe("readEnv", () => {
  it("treats empty values as unset, as in a .env copied from .env.example", () => {
    expect(
      readEnv({
        TURBINE_NETWORK: "",
        TURBINE_ACCOUNT: " ",
        TURBINE_WALLET_PASSWORD: "",
        TURBINE_API_URL: "",
      })
    ).toEqual({});
  });

  it("reads every setting", () => {
    expect(
      readEnv({
        TURBINE_NETWORK: "playground",
        TURBINE_ACCOUNT: "trading",
        TURBINE_WALLET_PASSWORD: "correct horse",
        TURBINE_API_URL: "http://localhost:3000/api",
        TURBINE_RPC_URL: "https://rpc.example.com",
      })
    ).toEqual({
      network: "playground",
      account: "trading",
      walletPassword: "correct horse",
      apiUrl: "http://localhost:3000/api",
      rpcUrl: "https://rpc.example.com",
    });
  });

  it("names a bad setting without repeating its value", () => {
    const error = thrown(() =>
      readEnv({ TURBINE_API_URL: "not a url secretvalue" })
    );
    expect(error.code).toBe("CONFIG_INVALID");
    expect(error.params).toEqual({ variable: "TURBINE_API_URL" });
  });

  it("rejects an unknown network", () => {
    const error = thrown(() => readEnv({ TURBINE_NETWORK: "testnet" }));
    expect(error.params).toEqual({ variable: "TURBINE_NETWORK" });
  });
});
