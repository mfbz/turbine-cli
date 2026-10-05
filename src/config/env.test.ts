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
        TURBINE_PRIVATE_KEY: "",
        TURBINE_KEY_FILE: " ",
        TURBINE_API_URL: "",
      })
    ).toEqual({});
  });

  it("reads every setting", () => {
    expect(
      readEnv({
        TURBINE_NETWORK: "playground",
        TURBINE_PRIVATE_KEY: "abc",
        TURBINE_KEY_FILE: "./key.txt",
        TURBINE_API_URL: "http://localhost:3000/api",
        TURBINE_RPC_URL: "https://rpc.example.com",
      })
    ).toEqual({
      network: "playground",
      privateKey: "abc",
      keyFile: "./key.txt",
      apiUrl: "http://localhost:3000/api",
      rpcUrl: "https://rpc.example.com",
    });
  });

  it("lets the real environment win over .env", () => {
    const dotenv = "TURBINE_NETWORK=mainnet\nTURBINE_KEY_FILE=./from-dotenv\n";
    expect(readEnv({ TURBINE_NETWORK: "playground" }, dotenv)).toEqual({
      network: "playground",
      keyFile: "./from-dotenv",
    });
  });

  it("parses comments and quotes in .env", () => {
    const dotenv = '# a comment\nTURBINE_KEY_FILE="./my key"\n';
    expect(readEnv({}, dotenv)).toEqual({ keyFile: "./my key" });
  });

  it("names a bad setting without repeating its value", () => {
    const error = thrown(() =>
      readEnv({ TURBINE_API_URL: "not a url secretvalue" })
    );
    expect(error.code).toBe("CONFIG_INVALID");
    expect(error.message).toContain("TURBINE_API_URL");
    expect(error.message).not.toContain("secretvalue");
  });

  it("lists the networks it accepts", () => {
    const error = thrown(() => readEnv({ TURBINE_NETWORK: "testnet" }));
    expect(error.code).toBe("CONFIG_INVALID");
    expect(error.message).toContain("playground");
    expect(error.message).toContain("mainnet");
  });
});

describe("loadEnv", () => {
  it("reads .env from the folder it runs in", () => {
    const cwd = mkdtempSync(join(tmpdir(), "turbine-env-"));
    dirs.push(cwd);
    writeFileSync(join(cwd, ".env"), "TURBINE_KEY_FILE=./k\n");
    expect(loadEnv({ env: {}, cwd })).toEqual({ keyFile: "./k" });
  });

  it("works without a .env", () => {
    const cwd = mkdtempSync(join(tmpdir(), "turbine-env-"));
    dirs.push(cwd);
    expect(loadEnv({ env: { TURBINE_NETWORK: "playground" }, cwd })).toEqual({
      network: "playground",
    });
  });
});
