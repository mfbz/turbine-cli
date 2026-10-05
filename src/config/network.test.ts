import { describe, expect, it } from "vitest";

import { CliError } from "../output/errors.ts";
import { resolveNetwork } from "./network.ts";

function thrown(fn: () => unknown): CliError {
  try {
    fn();
  } catch (error) {
    if (error instanceof CliError) return error;
    throw error;
  }
  throw new Error("expected a CliError");
}

describe("resolveNetwork", () => {
  it("is the playground unless told otherwise", () => {
    expect(resolveNetwork({ env: {} })).toEqual({
      name: "playground",
      apiUrl: "https://playground-api.turbine.exchange/api",
      chainId: 1,
    });
  });

  it("uses mainnet with --network mainnet", () => {
    expect(resolveNetwork({ flag: "mainnet", env: {} })).toMatchObject({
      name: "mainnet",
      apiUrl: "https://api.turbine.exchange/api",
    });
  });

  it("refuses mainnet from the environment alone", () => {
    const error = thrown(() => resolveNetwork({ env: { network: "mainnet" } }));
    expect(error.code).toBe("MAINNET_NEEDS_FLAG");
  });

  it("lets the flag win over the environment", () => {
    expect(
      resolveNetwork({ flag: "mainnet", env: { network: "playground" } }).name
    ).toBe("mainnet");
    expect(
      resolveNetwork({ flag: "playground", env: { network: "mainnet" } }).name
    ).toBe("playground");
  });

  it("rejects an unknown network as a usage error", () => {
    const error = thrown(() => resolveNetwork({ flag: "testnet", env: {} }));
    expect(error.code).toBe("NETWORK_UNKNOWN");
    expect(error.params).toEqual({ network: "testnet" });
  });

  it("refuses an API override pointing anywhere but this computer, since the API decides what gets signed", () => {
    for (const apiUrl of [
      "https://evil.example/api",
      "https://api.turbine.exchange.evil.example/api",
      "http://localhost.evil.example/api",
    ]) {
      const error = thrown(() => resolveNetwork({ env: { apiUrl } }));
      expect(error.code, apiUrl).toBe("API_URL_NOT_ALLOWED");
    }
  });

  it("refuses any API override on mainnet", () => {
    const error = thrown(() =>
      resolveNetwork({
        flag: "mainnet",
        env: { apiUrl: "http://localhost:3000/api" },
      })
    );
    expect(error.code).toBe("API_URL_NOT_ALLOWED");
  });

  it("allows a local mock on 127.0.0.1 too", () => {
    expect(
      resolveNetwork({ env: { apiUrl: "http://127.0.0.1:8080/api" } }).apiUrl
    ).toBe("http://127.0.0.1:8080/api");
  });

  it("takes API and RPC overrides, without a trailing slash on the API (the SDK compares it exactly)", () => {
    expect(
      resolveNetwork({
        env: {
          apiUrl: "http://localhost:3000/api/",
          rpcUrl: "https://rpc.example.com",
        },
      })
    ).toEqual({
      name: "playground",
      apiUrl: "http://localhost:3000/api",
      chainId: 1,
      rpcUrl: "https://rpc.example.com",
    });
  });
});
