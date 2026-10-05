import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CliError } from "../output/errors.ts";
import { loadEnv, readEnv } from "./env.ts";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true });
});

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

  it("lets the real environment win over .env", () => {
    const dotenv = "TURBINE_NETWORK=mainnet\nTURBINE_ACCOUNT=from-dotenv\n";
    expect(readEnv({ TURBINE_NETWORK: "playground" }, dotenv)).toEqual({
      network: "playground",
      account: "from-dotenv",
    });
  });

  it("parses comments and quotes in .env", () => {
    const dotenv = '# a comment\nTURBINE_ACCOUNT="trading"\n';
    expect(readEnv({}, dotenv)).toEqual({ account: "trading" });
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

describe("endpoints in .env", () => {
  it("are refused, since a .env can come with any folder you run turbine in", () => {
    for (const line of [
      "TURBINE_RPC_URL=https://rpc.evil.example",
      "TURBINE_API_URL=http://localhost:3000/api",
    ]) {
      const error = thrown(() => readEnv({}, `${line}\n`));
      expect(error.code, line).toBe("ENDPOINT_IN_DOTENV");
    }
  });

  it("are accepted from the real environment", () => {
    expect(readEnv({ TURBINE_RPC_URL: "https://rpc.example.com" }, "")).toEqual(
      {
        rpcUrl: "https://rpc.example.com",
      }
    );
  });
});

describe("the wallet password in .env", () => {
  it("is refused: a .env can come with any folder", () => {
    expect(
      thrown(() => readEnv({}, "TURBINE_WALLET_PASSWORD=hunter22\n")).code
    ).toBe("PASSWORD_IN_DOTENV");
  });
});

describe("loadEnv", () => {
  it("reads .env from the folder it runs in", () => {
    const cwd = mkdtempSync(join(tmpdir(), "turbine-env-"));
    dirs.push(cwd);
    writeFileSync(join(cwd, ".env"), "TURBINE_ACCOUNT=trading\n");
    expect(loadEnv({ env: {}, cwd })).toEqual({ account: "trading" });
  });

  it("works without a .env", () => {
    const cwd = mkdtempSync(join(tmpdir(), "turbine-env-"));
    dirs.push(cwd);
    expect(loadEnv({ env: { TURBINE_NETWORK: "playground" }, cwd })).toEqual({
      network: "playground",
    });
  });
});
