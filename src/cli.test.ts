import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, describe, expect, it } from "vitest";

import pkg from "../package.json" with { type: "json" };
import { run } from "./cli.ts";
import type { Io } from "./cli.ts";

const ANSI = /\u001b\[/;
const roots: string[] = [];

type Doc = {
  ok: boolean;
  data: Record<string, unknown>;
  error: { code: string; message: string; hint: string };
};
type Options = {
  env?: Record<string, string>;
  tty?: boolean;
  answers?: string[];
  home?: string;
  cwd?: string;
};

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "turbine-cli-"));
  roots.push(dir);
  return dir;
}

async function capture(argv: string[], options: Options = {}) {
  let out = "";
  let err = "";
  const home = options.home ?? tempDir();
  const answers = [...(options.answers ?? [])];
  const io: Io = {
    stdout: (text) => (out += text),
    stderr: (text) => (err += text),
    env: options.env ?? {},
    cwd: options.cwd ?? tempDir(),
    home,
    platform: "darwin",
    stdoutInfo: options.tty
      ? { isTTY: true, columns: 100, getColorDepth: () => 24 }
      : { isTTY: false },
    interactive: options.tty ?? false,
    prompter: { secret: () => Promise.resolve(answers.shift()) },
    scryptN: 1024,
  };
  const code = await run(argv, io);
  return { code, out, err, all: out + err, doc: () => JSON.parse(out) as Doc };
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
      "wallet",
      "--network",
      "--account",
      "--password-file",
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

  it("rejects an unknown option or command with exit 2, naming the option but never a value", async () => {
    const option = await capture(["config", "--bogus=s3cr3tvalue"]);
    expect(option.code).toBe(2);
    expect(option.out).toBe("");
    expect(option.err).toContain("--bogus");
    expect(option.err).not.toContain("s3cr3tvalue");
    const command = await capture(["nope"]);
    expect(command.code).toBe(2);
    expect(command.err).toContain("nope");
  });

  it("answers in JSON for usage errors, help and version with --json", async () => {
    const usage = await capture(["--json", "--nope"]);
    expect(usage.code).toBe(2);
    expect(usage.err).toBe("");
    expect(usage.doc().error.code).toBe("USAGE_UNKNOWN_OPTION");
    expect((await capture(["--json", "--version"])).doc().data).toEqual({
      version: pkg.version,
    });
    for (const argv of [["--json", "--help"], ["--json"]]) {
      expect(String((await capture(argv)).doc().data.help)).toContain("Usage");
    }
  });
});

describe("a private key on the command line", () => {
  it("is refused before anything can echo it, wherever it appears", async () => {
    const key = generatePrivateKey();
    for (const argv of [
      ["config", "--network", key],
      [key],
      ["config", `--bogus=${key}`],
      ["wallet", "import", key.slice(2)],
      ["--json", "config", key],
    ]) {
      const result = await capture(argv);
      expect(result.code, argv.join(" ")).toBe(2);
      expect(result.all.toLowerCase(), argv.join(" ")).not.toContain(
        key.slice(2)
      );
      expect(result.all).toContain(
        argv[0] === "--json" ? "KEY_IN_ARGV" : "private key"
      );
    }
  });
});

describe("turbine wallet", () => {
  it("creates an encrypted wallet without a terminal when the password comes from the shell", async () => {
    const home = tempDir();
    const env = { TURBINE_WALLET_PASSWORD: "correct horse" };
    const created = await capture(["wallet", "new", "trading", "--json"], {
      env,
      home,
    });
    expect(created.code).toBe(0);
    const { address, path } = created.doc().data as {
      address: string;
      path: string;
    };
    expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(path).toContain(join(home, ".config", "turbine-cli", "wallets"));
    expect(created.all).not.toContain("correct horse");

    const list = await capture(["wallet", "list", "--json"], { home });
    expect(list.doc().data).toEqual([
      expect.objectContaining({
        name: "trading",
        address: address.toLowerCase(),
      }),
    ]);
    const config = await capture(["config", "--account", "trading", "--json"], {
      home,
    });
    expect(config.doc().data.wallet).toEqual({
      name: "trading",
      address: address.toLowerCase(),
      source: "turbine",
    });
  });

  it("asks for a password twice in a terminal", async () => {
    const result = await capture(["wallet", "new"], {
      tty: true,
      answers: ["long enough pw", "long enough pw"],
    });
    expect(result.code).toBe(0);
    expect(result.out).toContain("default");
  });

  it("fails rather than waits when there is no terminal and no password", async () => {
    const result = await capture(["wallet", "new", "--json"]);
    expect(result.code).toBe(1);
    expect(result.doc().error.code).toBe("PASSWORD_REQUIRED");
  });

  it("imports a key only through a hidden prompt, and never shows it", async () => {
    const key = generatePrivateKey();
    const result = await capture(["wallet", "import", "mine", "--json"], {
      tty: true,
      answers: [key, "password one", "password one"],
    });
    expect(result.code).toBe(0);
    expect(result.doc().data.address).toBe(privateKeyToAccount(key).address);
    expect(result.all.toLowerCase()).not.toContain(key.slice(2));

    const piped = await capture(["wallet", "import", "--json"]);
    expect(piped.doc().error.code).toBe("TERMINAL_REQUIRED");
  });

  it("rejects something that isn't a key without repeating it", async () => {
    const typed = generatePrivateKey().slice(0, 50);
    const result = await capture(["wallet", "import", "--json"], {
      tty: true,
      answers: [typed],
    });
    expect(result.doc().error.code).toBe("KEY_INVALID");
    expect(result.all).not.toContain(typed.slice(2));
  });

  it("never reads the wallet password from .env", async () => {
    const cwd = tempDir();
    writeFileSync(join(cwd, ".env"), "TURBINE_WALLET_PASSWORD=hunter22\n");
    const result = await capture(["wallet", "new", "--json"], { cwd });
    expect(result.doc().error.code).toBe("PASSWORD_IN_DOTENV");
  });
});

describe("turbine config", () => {
  it("shows the playground and no wallet on a fresh setup", async () => {
    const { code, out } = await capture(["config"]);
    expect(code).toBe(0);
    expect(out).toContain("playground");
    expect(out).toContain("https://playground-api.turbine.exchange/api");
    expect(out).toMatch(/no wallet/i);
  });

  it("returns the setup as JSON", async () => {
    expect((await capture(["config", "--json"])).doc()).toEqual({
      ok: true,
      data: {
        network: "playground",
        apiUrl: "https://playground-api.turbine.exchange/api",
        rpcUrl: null,
        wallet: null,
      },
    });
  });

  it("insists on a wallet asked for by name", async () => {
    const result = await capture(["config", "--account", "missing", "--json"]);
    expect(result.doc().error.code).toBe("WALLET_NOT_FOUND");
  });

  it("refuses mainnet from the environment alone, and uses it with the flag", async () => {
    const env = { TURBINE_NETWORK: "mainnet" };
    expect((await capture(["config"], { env })).code).toBe(1);
    expect(
      (
        await capture(["config", "--network", "mainnet", "--json"], { env })
      ).doc().data.network
    ).toBe("mainnet");
  });

  it("writes no colour codes when piped, and some in a colour terminal", async () => {
    expect((await capture(["config"])).out).not.toMatch(ANSI);
    expect((await capture(["config"], { tty: true })).out).toMatch(ANSI);
  });
});
