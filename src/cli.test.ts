import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, describe, expect, it } from "vitest";

import pkg from "../package.json" with { type: "json" };
import { run } from "./cli.ts";
import type { Io } from "./cli.ts";
import { createFakeApi } from "./turbine/fake-api.ts";
import type { Chain } from "./turbine/chain.ts";
import type { SignRequest, Signer } from "./turbine/sdk-orders.ts";
import { decryptKey } from "./wallet/keystore.ts";
import { findWallet, readWallet, walletDirs } from "./wallet/store.ts";

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
  choices?: string[];
  confirms?: boolean[];
  texts?: string[];
  home?: string;
  chain?: Partial<{ balance: bigint; allowance: bigint; fail: boolean }>;
  // What listing the wallet's orders returns, call after call (the last one repeats).
  listed?: unknown[];
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

const PLACED = `0x${"cd".repeat(32)}` as const;
const FILLED = {
  hash: `0x${"cd".repeat(32)}` as const,
  status: "Filled",
  executedSellAmount: 0n,
  executedBuyAmount: 0n,
  execution: [],
};
const LISTED = {
  hash: PLACED,
  status: "Active",
  executedSellAmount: 0n,
  executedBuyAmount: 0n,
  execution: [],
};
let sentTransactions: string[] = [];
let signers: string[] = [];

function submitted(signer: Signer, purpose: SignRequest["purpose"]) {
  signers.push(
    signer.kind === "account"
      ? signer.account.address
      : `dry-run ${signer.address}`
  );
  return signer.kind === "dry-run"
    ? {
        kind: "dry-run" as const,
        sign: [{ purpose, typedData: { primaryType: "X" } }],
      }
    : { kind: "sent" as const, hash: PLACED };
}

function fakeChain(over: Options["chain"] = {}): Chain {
  return {
    reader: {
      balance: () =>
        over.fail
          ? Promise.reject(new Error("down"))
          : Promise.resolve(over.balance ?? 0n),
      allowance: () =>
        over.fail
          ? Promise.reject(new Error("down"))
          : Promise.resolve(over.allowance ?? 0n),
    },
    writer: {
      send: (call) => {
        sentTransactions.push(call.data);
        return Promise.resolve(`0x${"ef".repeat(32)}` as const);
      },
    },
  };
}

async function capture(argv: string[], options: Options = {}) {
  let out = "";
  let err = "";
  const home = options.home ?? tempDir();
  const answers = [...(options.answers ?? [])];
  const choices = [...(options.choices ?? [])];
  const confirms = [...(options.confirms ?? [])];
  const texts = [...(options.texts ?? [])];
  const listed = [...(options.listed ?? [])];
  const io: Io = {
    stdout: (text) => (out += text),
    stderr: (text) => (err += text),
    env: options.env ?? {},
    home,
    platform: "darwin",
    stdoutInfo: options.tty
      ? { isTTY: true, columns: 100, getColorDepth: () => 24 }
      : { isTTY: false },
    interactive: options.tty ?? false,
    prompter: {
      secret: () => Promise.resolve(answers.shift()),
      choose: <T extends string>() =>
        Promise.resolve(choices.shift() as T | undefined),
      confirm: () => Promise.resolve(confirms.shift()),
      text: () => Promise.resolve(texts.shift()),
    },
    scryptN: 1024,
    api: () => createFakeApi(),
    chain: () => fakeChain(options.chain),
    orders: {
      openOrderReader: () => ({
        list: () => {
          if (!options.listed) return Promise.resolve([LISTED]);
          const next = listed.length > 1 ? listed.shift() : listed[0];
          return Promise.resolve(
            next === undefined ? [] : [next as typeof LISTED]
          );
        },
      }),
      listOrders: () => {
        if (!options.listed) return Promise.resolve([LISTED]);
        const next = listed.length > 1 ? listed.shift() : listed[0];
        return Promise.resolve(
          next === undefined ? [] : [next as typeof LISTED]
        );
      },
      submitOrders: (plans, signer: Signer) =>
        Promise.resolve(
          signer.kind === "dry-run"
            ? {
                kind: "dry-run" as const,
                sign: plans.map(() => [
                  { purpose: "order" as const, typedData: {} },
                ]),
              }
            : { kind: "sent" as const, hashes: plans.map(() => PLACED) }
        ),
      submitOrder: (_plan, signer: Signer) =>
        Promise.resolve(submitted(signer, "order")),
      submitCancel: (_hash, _settler, signer: Signer) =>
        Promise.resolve(submitted(signer, "cancel")),
    },
    now: () => 1_800_000_000,
    sleep: () => Promise.resolve(),
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
        address,
      }),
    ]);
    const config = await capture(["config", "--account", "trading", "--json"], {
      home,
    });
    expect(config.doc().data.wallet).toEqual({
      name: "trading",
      address,
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

  it("ignores a .env in the current folder: a cloned folder can't choose the wallet, the password or the API", async () => {
    const cwd = tempDir();
    writeFileSync(
      join(cwd, ".env"),
      "TURBINE_ACCOUNT=someone-elses\nTURBINE_WALLET_PASSWORD=hunter22\nTURBINE_RPC_URL=https://rpc.evil.example\n"
    );
    const before = process.cwd();
    process.chdir(cwd);
    const result = await capture(["config", "--json"]).finally(() =>
      process.chdir(before)
    );
    expect(result.code).toBe(0);
    expect(result.doc().data).toMatchObject({ wallet: null, rpcUrl: null });
  });
});

// The session tests skip the header's animation, which would otherwise take a second or two each.
const STILL = { TURBINE_NO_MOTION: "1" };

describe("the interactive session", () => {
  it("opens with the header and a menu in a terminal, and quits cleanly", async () => {
    const result = await capture([], {
      tty: true,
      choices: ["config", "quit"],
    });
    expect(result.code).toBe(0);
    expect(result.out).toContain("trade slow, pay less");
    expect(result.out).toContain("playground-api.turbine.exchange");
    expect(result.out).not.toContain("Usage");
  });

  it("treats a cancelled menu as quitting", async () => {
    const result = await capture([], { tty: true, choices: [], env: STILL });
    expect(result.code).toBe(0);
  });

  it("shows an error from one action and carries on", async () => {
    const result = await capture([], {
      tty: true,
      env: STILL,
      choices: ["wallet-new", "wallets", "quit"],
      texts: ["main"],
      answers: ["short", "short"],
    });
    expect(result.code).toBe(0);
    expect(result.err).toContain("too short");
    expect(result.out).toMatch(/No wallets yet/);
  });

  it("asks before switching to mainnet, and the setup then says so", async () => {
    const declined = await capture([], {
      tty: true,
      env: STILL,
      choices: ["network", "mainnet", "config", "quit"],
      confirms: [false],
    });
    expect(declined.out).toContain("simulated, no real funds");
    expect(declined.out).not.toContain("▲ mainnet");
    const accepted = await capture([], {
      tty: true,
      env: STILL,
      choices: ["network", "mainnet", "config", "quit"],
      confirms: [true],
    });
    expect(accepted.out).toContain("▲ mainnet");
  });

  it("doesn't offer to switch networks when --network was given", async () => {
    const result = await capture(["--network", "playground"], {
      tty: true,
      env: STILL,
      choices: ["network", "config", "quit"],
    });
    expect(result.out).toContain("simulated, no real funds");
    expect(result.err).not.toMatch(/error/);
  });

  it("goes quietly back to the menu when a question is cancelled", async () => {
    const result = await capture([], {
      tty: true,
      env: STILL,
      choices: ["wallet-new", "quit"],
      texts: [],
    });
    expect(result.code).toBe(0);
    expect(result.err).not.toContain("error");
  });

  it("is never opened without a terminal or with --json", async () => {
    expect((await capture([])).out).toContain("Usage");
    expect(
      String((await capture(["--json"], { tty: true })).doc().data.help)
    ).toContain("Usage");
  });
});

describe("turbine tokens and turbine quote", () => {
  it("lists the tokens Turbine supports", async () => {
    const human = await capture(["tokens"]);
    expect(human.out).toContain("WETH");
    expect(human.out).toContain("18 decimals");
    const json = await capture(["tokens", "--json"]);
    expect(json.doc().data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ symbol: "USDC", decimals: 6 }),
      ])
    );
  });

  it("quotes a pair with a spread", async () => {
    const result = await capture([
      "quote",
      "1",
      "WETH",
      "USDC",
      "--spread",
      "50",
      "--json",
    ]);
    expect(result.code).toBe(0);
    expect(result.doc().data).toMatchObject({
      midPrice: "2500",
      spreadBps: 50,
      atSpread: { amount: "2487.5" },
    });
    const human = await capture(["quote", "1", "WETH", "USDC"]);
    expect(human.out).toContain("2500 USDC per WETH");
  });

  it("explains bad input in its own words, with usage exit codes", async () => {
    const bad = await capture(["quote", "abc", "WETH", "USDC", "--json"]);
    expect(bad.code).toBe(2);
    expect(bad.doc().error.code).toBe("AMOUNT_INVALID");
    const spread = await capture([
      "quote",
      "1",
      "WETH",
      "USDC",
      "--spread",
      "1.5",
      "--json",
    ]);
    expect(spread.doc().error.code).toBe("SPREAD_INVALID");
    const missing = await capture(["quote", "1", "WETH", "--json"]);
    expect(missing.doc().error.code).toBe("USAGE_MISSING_ARGUMENT");
  });

  it("offers a quote in the interactive session", async () => {
    const result = await capture([], {
      tty: true,
      env: STILL,
      choices: ["quote", "quit"],
      texts: ["1", "WETH", "USDC", "25"],
    });
    expect(result.out).toContain("2500 USDC per WETH");
    expect(result.out).toContain("25 bps");
  });
});

async function withWallet(home: string) {
  await capture(["wallet", "new", "main"], {
    env: { TURBINE_WALLET_PASSWORD: "correct horse" },
    home,
  });
  return { TURBINE_WALLET_PASSWORD: "correct horse", TURBINE_ACCOUNT: "main" };
}

describe("turbine order place", () => {
  const ORDER = [
    "order",
    "place",
    "1",
    "WETH",
    "--for",
    "USDC",
    "--spread",
    "50",
    "--ttl",
    "1h",
    "--limit",
    "2400",
  ];

  it("dry-runs: shows what would be signed, signs nothing, needs no password", async () => {
    const home = tempDir();
    await withWallet(home);
    signers = [];
    const result = await capture([...ORDER, "--dry-run", "--json"], {
      home,
      env: { TURBINE_ACCOUNT: "main" },
    });
    expect(result.code).toBe(0);
    const data = result.doc().data as {
      dryRun: boolean;
      order: { permit2: { amount: string } };
      sign: unknown[];
    };
    expect(data.dryRun).toBe(true);
    expect(data.order.permit2.amount).toBe("unlimited");
    expect(data.sign).toHaveLength(1);
    expect(signers[0]).toMatch(/^dry-run 0x/);
  });

  it("places on the playground and names the next command", async () => {
    const home = tempDir();
    const env = await withWallet(home);
    signers = [];
    const json = await capture([...ORDER, "--json"], { home, env });
    expect(json.doc().data).toMatchObject({ dryRun: false, hash: PLACED });
    expect(signers[0]).toMatch(/^0x/);
    const human = await capture(ORDER, { home, env });
    expect(human.out).toContain(`turbine order watch ${PLACED}`);
    expect(human.err).toContain("You sign");
    expect(human.err).toContain("unlimited WETH");
  });

  it("on mainnet, refuses without a terminal unless --yes, and asks in one", async () => {
    const home = tempDir();
    const env = await withWallet(home);
    const enough = { balance: 10n ** 30n, allowance: 2n ** 256n - 1n };
    const refused = await capture(
      [...ORDER, "--network", "mainnet", "--json"],
      { home, env, chain: enough }
    );
    expect(refused.doc().error.code).toBe("CONFIRMATION_REQUIRED");
    const yes = await capture(
      [...ORDER, "--network", "mainnet", "--yes", "--json"],
      { home, env, chain: enough }
    );
    expect(yes.doc().data).toMatchObject({ hash: PLACED });
    const declined = await capture([...ORDER, "--network", "mainnet"], {
      home,
      env,
      chain: enough,
      tty: true,
      confirms: [false],
    });
    expect(declined.code).toBe(130);
  });

  it("asks before signing on the playground when Ethereum can't be checked", async () => {
    const home = tempDir();
    const env = await withWallet(home);
    const result = await capture([...ORDER, "--json"], {
      home,
      env,
      chain: { fail: true },
    });
    expect(result.doc().error.code).toBe("CONFIRMATION_REQUIRED");
  });

  it("asks before signing on the playground when the wallet's real tokens are exposed", async () => {
    const home = tempDir();
    const env = await withWallet(home);
    const exposed = { balance: 10n ** 30n, allowance: 2n ** 256n - 1n };
    const result = await capture([...ORDER, "--json"], {
      home,
      env,
      chain: exposed,
    });
    expect(result.doc().error.code).toBe("CONFIRMATION_REQUIRED");
  });

  it("needs a wallet, and checks input before asking for anything", async () => {
    const none = await capture([...ORDER, "--json"]);
    expect(none.doc().error.code).toBe("WALLET_NONE");
    const home = tempDir();
    const env = await withWallet(home);
    const bad = await capture(
      [
        "order",
        "place",
        "1",
        "WETH",
        "--for",
        "USDC",
        "--spread",
        "50",
        "--ttl",
        "5s",
        "--json",
      ],
      { home, env }
    );
    expect(bad.doc().error.code).toBe("TTL_TOO_SHORT");
  });
});

describe("turbine orders and turbine order cancel", () => {
  it("lists the wallet's orders after unlocking it", async () => {
    const home = tempDir();
    const env = await withWallet(home);
    const result = await capture(["orders", "--status", "active", "--json"], {
      home,
      env,
    });
    expect(result.doc().data).toEqual([
      expect.objectContaining({ hash: PLACED, status: "Active" }),
    ]);
    expect(
      (
        await capture(["orders", "--status", "open", "--json"], { home, env })
      ).doc().error.code
    ).toBe("STATUS_UNKNOWN");
  });

  it("cancels by hash: an order hash isn't mistaken for a key", async () => {
    const home = tempDir();
    const env = await withWallet(home);
    const dry = await capture(
      ["order", "cancel", PLACED, "--dry-run", "--json"],
      { home, env }
    );
    expect(dry.code).toBe(0);
    expect(dry.doc().data).toMatchObject({ dryRun: true, hash: PLACED });
    const sent = await capture(["order", "cancel", PLACED, "--json"], {
      home,
      env,
    });
    expect(sent.doc().data).toMatchObject({ status: "cancelling" });
    const bad = await capture(["order", "cancel", "0x1234", "--json"], {
      home,
      env,
    });
    expect(bad.doc().error.code).toBe("HASH_INVALID");
  });

  it("still refuses a key-shaped value anywhere else", async () => {
    const result = await capture([
      "order",
      "place",
      PLACED.slice(2),
      "WETH",
      "--json",
    ]);
    expect(result.doc().error.code).toBe("KEY_IN_ARGV");
  });

  it("watches an order until it is done: NDJSON with --json, plain lines when piped", async () => {
    const home = tempDir();
    const env = await withWallet(home);
    const json = await capture(["order", "watch", PLACED, "--json"], {
      home,
      env,
      listed: [LISTED, FILLED],
    });
    const events = json.out
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { type: string });
    expect(events.map((e) => e.type)).toEqual(["state", "final"]);
    expect(json.code).toBe(0);
    const lines = await capture(["order", "watch", PLACED], {
      home,
      env,
      listed: [LISTED, FILLED],
    });
    expect(lines.out).toMatch(/active[\s\S]*filled/);
  });

  it("says so when the order isn't the wallet's", async () => {
    const home = tempDir();
    const env = await withWallet(home);
    const result = await capture(["order", "watch", PLACED, "--json"], {
      home,
      env,
      listed: [],
    });
    expect(result.doc().error.code).toBe("ORDER_NOT_FOUND");
  });

  it("asks before cancelling on mainnet", async () => {
    const home = tempDir();
    const env = await withWallet(home);
    const refused = await capture(
      ["order", "cancel", PLACED, "--network", "mainnet", "--json"],
      { home, env }
    );
    expect(refused.doc().error.code).toBe("CONFIRMATION_REQUIRED");
  });
});

describe("turbine ladder", () => {
  const LADDER = [
    "ladder",
    "1",
    "WETH",
    "--for",
    "USDC",
    "--levels",
    "4",
    "--from",
    "-10",
    "--to",
    "20",
    "--ttl",
    "4h",
  ];

  it("dry-runs every level and places them in one batch", async () => {
    const home = tempDir();
    const env = await withWallet(home);
    const dry = await capture([...LADDER, "--dry-run", "--json"], {
      home,
      env,
    });
    const data = dry.doc().data as {
      dryRun: boolean;
      ladder: { levels: Array<{ spreadBps: number }> };
      sign: unknown[];
    };
    expect(data.dryRun).toBe(true);
    expect(data.ladder.levels.map((l) => l.spreadBps)).toEqual([
      -10, 0, 10, 20,
    ]);
    expect(data.sign).toHaveLength(4);
    const placed = await capture([...LADDER, "--json"], { home, env });
    expect(placed.doc().data).toMatchObject({
      dryRun: false,
      hashes: [PLACED, PLACED, PLACED, PLACED],
    });
    const human = await capture(LADDER, { home, env });
    expect(human.err).toContain("4 orders");
  });

  it("asks first on mainnet", async () => {
    const home = tempDir();
    const env = await withWallet(home);
    const enough = { balance: 10n ** 30n, allowance: 2n ** 256n - 1n };
    const refused = await capture(
      [...LADDER, "--network", "mainnet", "--json"],
      { home, env, chain: enough }
    );
    expect(refused.doc().error.code).toBe("CONFIRMATION_REQUIRED");
  });
});

describe("turbine approve", () => {
  it("dry-runs the exact transaction, and sends it only with --yes or a confirmation", async () => {
    const home = tempDir();
    const env = await withWallet(home);
    sentTransactions = [];
    const dry = await capture(["approve", "WETH", "--dry-run", "--json"], {
      home,
      env,
    });
    expect(dry.doc().data).toMatchObject({
      status: "dry-run",
      transactions: [{ chainId: 1, amount: "unlimited" }],
    });
    const refused = await capture(["approve", "WETH", "--json"], { home, env });
    expect(refused.doc().error.code).toBe("CONFIRMATION_REQUIRED");
    expect(sentTransactions).toEqual([]);
    const sent = await capture(["approve", "WETH", "--yes", "--json"], {
      home,
      env,
    });
    expect(sent.doc().data).toMatchObject({ status: "approved" });
    expect(sentTransactions).toHaveLength(1);
  });

  it("treats an allowance above uint160 as unlimited, as Permit2 does", async () => {
    const home = tempDir();
    const env = await withWallet(home);
    const result = await capture(["approve", "WETH", "--json"], {
      home,
      env,
      chain: { allowance: 2n ** 200n },
    });
    expect(result.doc().data).toMatchObject({ status: "already-approved" });
  });

  it("does nothing when Permit2 is already approved", async () => {
    const home = tempDir();
    const env = await withWallet(home);
    const result = await capture(["approve", "WETH", "--json"], {
      home,
      env,
      chain: { allowance: 2n ** 256n - 1n },
    });
    expect(result.doc().data).toMatchObject({ status: "already-approved" });
  });
});

describe("review fixes", () => {
  it("shows only the RPC endpoint's origin: provider URLs carry API keys in the path", async () => {
    const env = {
      TURBINE_RPC_URL: "https://eth-mainnet.example.com/v2/SECRETAPIKEY123?x=1",
    };
    const human = await capture(["config"], { env });
    const json = await capture(["config", "--json"], { env });
    expect(human.all + json.all).not.toContain("SECRETAPIKEY123");
    expect(json.doc().data.rpcUrl).toBe("https://eth-mainnet.example.com");
  });

  it("shows help for a group of commands run without a subcommand", async () => {
    const human = await capture(["wallet"]);
    expect(human.out).toContain("new");
    expect(
      String((await capture(["wallet", "--json"])).doc().data.help)
    ).toContain("import");
  });

  it("keeps a password from the shell exactly as given, spaces included", async () => {
    const home = tempDir();
    const env = { TURBINE_WALLET_PASSWORD: "  spaced pass  " };
    await capture(["wallet", "new", "w1"], { env, home });
    const ref = findWallet("w1", walletDirs({}, home, "darwin"));
    await expect(
      decryptKey(readWallet(ref, "darwin"), "  spaced pass  ")
    ).resolves.toMatch(/^0x/);
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
