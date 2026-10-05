import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";

import pkg from "../package.json" with { type: "json" };
import { run } from "./cli.ts";
import type { Io } from "./cli.ts";

const EMPTY_DIR = mkdtempSync(join(tmpdir(), "turbine-cli-"));
const ANSI = /\u001b\[/;

type ConfigDocument = {
  data: { network: string; wallet: { address: string; source: string } | null };
};

async function capture(
  argv: string[],
  env: Record<string, string> = {},
  tty = false
) {
  let out = "";
  let err = "";
  const io: Io = {
    stdout: (text) => (out += text),
    stderr: (text) => (err += text),
    env,
    cwd: EMPTY_DIR,
    stdoutInfo: tty
      ? { isTTY: true, columns: 100, getColorDepth: () => 24 }
      : { isTTY: false },
    keyFs: {
      readFile: () => {
        throw new Error("no files in tests");
      },
      mode: () => 0o100600,
      platform: "darwin",
    },
  };
  const code = await run(argv, io);
  return { code, out, err };
}

describe("turbine", () => {
  it("prints the version", async () => {
    for (const flag of ["--version", "-v"]) {
      const { code, out } = await capture([flag]);
      expect(code).toBe(0);
      expect(out).toBe(`${pkg.version}\n`);
    }
  });

  it("lists the commands and global flags in --help", async () => {
    const { code, out } = await capture(["--help"]);
    expect(code).toBe(0);
    for (const text of [
      "config",
      "--network",
      "--json",
      "--dry-run",
      "--yes",
      "--no-motion",
      "--debug",
    ])
      expect(out).toContain(text);
  });

  it("prints help when run without a command (the interactive session comes later)", async () => {
    const { code, out } = await capture([]);
    expect(code).toBe(0);
    expect(out).toContain("Usage");
  });

  it("rejects an unknown flag or command with exit 2, on stderr only", async () => {
    for (const argv of [["--nope"], ["nope"]]) {
      const { code, out, err } = await capture(argv);
      expect(code, argv.join(" ")).toBe(2);
      expect(out).toBe("");
      expect(err).toContain("nope");
    }
  });

  it("reports a usage error as one JSON document with --json", async () => {
    const { code, out, err } = await capture(["--json", "--nope"]);
    expect(code).toBe(2);
    expect(err).toBe("");
    expect(JSON.parse(out)).toMatchObject({
      ok: false,
      error: { code: "USAGE" },
    });
  });
});

describe("turbine config", () => {
  it("shows the playground by default", async () => {
    const { code, out } = await capture(["config"]);
    expect(code).toBe(0);
    expect(out).toContain("playground");
    expect(out).toContain("https://playground-api.turbine.exchange/api");
    expect(out).toMatch(/no wallet/i);
  });

  it("returns the setup as JSON", async () => {
    const { code, out } = await capture(["config", "--json"]);
    expect(code).toBe(0);
    expect(JSON.parse(out)).toEqual({
      ok: true,
      data: {
        network: "playground",
        apiUrl: "https://playground-api.turbine.exchange/api",
        rpcUrl: null,
        wallet: null,
      },
    });
  });

  it("names the wallet and never prints its key, in any mode", async () => {
    const key = generatePrivateKey();
    const { address } = privateKeyToAccount(key);
    for (const argv of [
      ["config"],
      ["config", "--json"],
      ["config", "--debug"],
      ["--json", "config", "--network", "nope"],
    ]) {
      const { out, err } = await capture(argv, { TURBINE_PRIVATE_KEY: key });
      expect((out + err).toLowerCase(), argv.join(" ")).not.toContain(
        key.slice(2)
      );
    }
    const { out } = await capture(["config", "--json"], {
      TURBINE_PRIVATE_KEY: key,
    });
    expect((JSON.parse(out) as ConfigDocument).data.wallet).toEqual({
      address,
      source: "env",
    });
  });

  it("refuses mainnet from the environment alone", async () => {
    const { code, err } = await capture(["config"], {
      TURBINE_NETWORK: "mainnet",
    });
    expect(code).toBe(1);
    expect(err).toContain("--network mainnet");
  });

  it("uses mainnet with the flag", async () => {
    const { out } = await capture(["config", "--network", "mainnet", "--json"]);
    expect((JSON.parse(out) as ConfigDocument).data.network).toBe("mainnet");
  });

  it("writes no colour codes when piped, and some in a colour terminal", async () => {
    expect((await capture(["config"])).out).not.toMatch(ANSI);
    expect((await capture(["config"], {}, true)).out).toMatch(ANSI);
  });
});
