import { Command, Option } from "@commander-js/extra-typings";

import pkg from "../package.json" with { type: "json" };
import { configReport, renderConfig } from "./commands/config.ts";
import {
  renderCreated,
  renderList,
  walletImport,
  walletList,
  walletNew,
} from "./commands/wallet.ts";
import type { WalletContext } from "./commands/wallet.ts";
import { runSession } from "./commands/session.ts";
import { readEnv } from "./config/env.ts";
import type { Env } from "./config/env.ts";
import { resolveNetwork } from "./config/network.ts";
import type { NetworkConfig } from "./config/network.ts";
import { parseBps, quoteCommand, renderQuote } from "./commands/quote.ts";
import { renderTokens, tokensCommand } from "./commands/tokens.ts";
import type { TurbineApi } from "./turbine/api.ts";
import { createHttpApi } from "./turbine/http.ts";
import { createChain } from "./turbine/chain.ts";
import type { Chain } from "./turbine/chain.ts";
import type {
  listOrders,
  openOrderReader,
  submitCancel,
  submitOrder,
} from "./turbine/sdk-orders.ts";
import { orderReport, parseStatuses, renderOrders } from "./commands/orders.ts";
import { cancelCommand, checkHash, renderCancel } from "./commands/cancel.ts";
import { watchOrder } from "./commands/watch.ts";
import { priceOf } from "./turbine/amounts.ts";
import { approveCommand, renderApprove } from "./commands/approve.ts";
import { placeCommand, renderPlaced, renderSummary } from "./commands/place.ts";
import { unlockWallet } from "./wallet/signer.ts";
import type { Hex } from "./wallet/signer.ts";
import { CliError } from "./output/errors.ts";
import type { ErrorCode } from "./output/errors.ts";
import { createOutput } from "./output/output.ts";
import type { Output, Writer } from "./output/output.ts";
import { detectTerminal } from "./output/terminal.ts";
import type { StreamLike } from "./output/terminal.ts";
import { createTheme } from "./output/theme.ts";
import type { Cursor } from "./ui/cursor.ts";
import { headerSize, playHeader } from "./ui/header.ts";
import type { Prompter, Unlocked } from "./wallet/signer.ts";
import { findWallet, walletDirs } from "./wallet/store.ts";
import type { WalletRef } from "./wallet/store.ts";

type Io = {
  stdout: Writer;
  stderr: Writer;
  env: Record<string, string | undefined>;
  home: string;
  platform: NodeJS.Platform;
  stdoutInfo: StreamLike;
  // Both ends are a terminal: only then can turbine-cli ask anything privately.
  interactive: boolean;
  prompter?: Prompter;
  // Test-only: a cheaper scrypt cost for new wallets.
  scryptN?: number;
  // The terminal cursor, shared with main.ts's Ctrl-C handler.
  cursor?: Cursor;
  // Test-only: Turbine itself (default: the HTTP API of the chosen network).
  api?: (network: NetworkConfig) => TurbineApi;
  // Test-only: Ethereum (default: TURBINE_RPC_URL or viem's public mainnet RPC).
  chain?: (network: NetworkConfig) => Chain;
  // Test-only: placing and cancelling through the SDK.
  orders?: {
    listOrders: typeof listOrders;
    openOrderReader: typeof openOrderReader;
    submitOrder: typeof submitOrder;
    submitCancel: typeof submitCancel;
  };
  // Test-only: the clock, in seconds.
  now?: () => number;
  // Test-only: waiting between polls.
  sleep?: (ms: number) => Promise<void>;
  // The keyboard for live views: calls back on each key until stopped (main.ts uses raw mode).
  keys?: (handler: (key: string) => void) => () => void;
};
type GlobalOptions = {
  network?: string;
  account?: string;
  passwordFile?: string;
  motion: boolean;
  dryRun?: boolean;
  yes?: boolean;
};
type Captured = { text: string };

// Commander's own outcomes that aren't failures.
const CLEAN_EXITS = new Set([
  "commander.helpDisplayed",
  "commander.version",
  "commander.help",
]);
// Commander's usage errors, in our words. Only an option-shaped name is ever shown back; values never.
const USAGE_CODES: Readonly<Record<string, ErrorCode>> = {
  "commander.unknownOption": "USAGE_UNKNOWN_OPTION",
  "commander.unknownCommand": "USAGE_UNKNOWN_COMMAND",
  "commander.missingArgument": "USAGE_MISSING_ARGUMENT",
  "commander.optionMissingArgument": "USAGE_MISSING_ARGUMENT",
  "commander.missingMandatoryOptionValue": "USAGE_MISSING_ARGUMENT",
  "commander.invalidArgument": "USAGE_INVALID_VALUE",
};
// Anything shaped like a private key, anywhere in what was typed.
const KEY_SHAPED = /(?:^|[^0-9a-fA-F])(?:0x)?[0-9a-fA-F]{64}(?![0-9a-fA-F])/;
const OPTION_NAME = /'(--?[a-z][a-z0-9-]{0,30})/;

// The one place a 64-hex value is expected: the order hash after `order cancel` or `order watch`, in
// its 0x form. Everywhere else such a value is refused as a possible private key.
const ORDER_HASH = /^0x[0-9a-fA-F]{64}$/;
const HASH_COMMANDS = new Set(["cancel", "watch"]);

function isOrderHash(argv: readonly string[], index: number): boolean {
  if (!ORDER_HASH.test(argv[index] ?? "")) return false;
  // Exactly the hash position: `order cancel <hash>` or `order watch <hash>`, after global flags
  // without values at most. Anywhere else the value is refused.
  const order = argv.findIndex((arg) => !arg.startsWith("-"));
  return (
    argv[order] === "order" &&
    HASH_COMMANDS.has(argv[order + 1] ?? "") &&
    index === order + 2
  );
}

function isCommanderError(error: unknown): error is { code: string } {
  const code: unknown =
    typeof error === "object" && error !== null
      ? (error as { code?: unknown }).code
      : undefined;
  return typeof code === "string" && code.startsWith("commander.");
}

function usageError(error: { code: string; message?: unknown }): CliError {
  const code = USAGE_CODES[error.code] ?? "USAGE";
  const message = typeof error.message === "string" ? error.message : "";
  // The option's name only (never what follows "="), and only if it looks like an option name.
  const option = OPTION_NAME.exec(message)?.[1] ?? "…";
  return new CliError(code, { option });
}

function buildProgram(
  io: Io,
  output: Output,
  secrets: string[],
  captured: Captured
) {
  const program = new Command("turbine")
    .description(
      "An unofficial command line for Turbine, the private orderbook on Ethereum."
    )
    .usage("[options] [command]")
    .version(pkg.version, "-v, --version", "print the version")
    .helpOption("-h, --help", "print this help")
    .addOption(
      new Option("--network <name>", "playground (default) or mainnet")
    )
    .option("--account <name>", "the wallet to use (default: default)")
    .option(
      "--password-file <path>",
      "read the wallet password from a file (chmod 600)"
    )
    .option("--json", "machine output: one JSON document on stdout")
    .option("--dry-run", "show what would be signed and sent, then stop")
    .option(
      "-y, --yes",
      "skip confirmations (mainnet needs it without a terminal)"
    )
    .option("--no-motion", "no animation")
    .option(
      "--debug",
      "on failure, add the error's class and stack frames (stderr)"
    )
    .argument("[command]")
    .exitOverride()
    .configureOutput({
      writeOut: (text) => {
        if (output.json) captured.text += text;
        else io.stdout(text);
      },
      // Commander writes help here when a group (turbine wallet) runs without a subcommand; it's
      // help, so it goes where help goes. Usage errors come through output.fail instead.
      writeErr: (text) => {
        if (output.json) captured.text += text;
        else io.stdout(text);
      },
      outputError: () => {},
    })
    .action(async (command) => {
      if (command !== undefined)
        throw new CliError("USAGE_UNKNOWN_COMMAND", { command });
      // No command: the interactive session in a terminal; help anywhere else.
      if (io.interactive && io.prompter && !output.json) {
        await session(io.prompter);
        return;
      }
      const help = program.helpInformation();
      output.result({ help }, () => help.trimEnd());
    });

  // The session can switch networks for what follows; a flag on the command line still wins.
  let sessionNetwork: string | undefined;
  const options = (): GlobalOptions => program.opts();
  const env = (): Env => readEnv(io.env);
  const network = () =>
    resolveNetwork({ flag: options().network ?? sessionNetwork, env: env() });
  const dirs = () => walletDirs(io.env, io.home, io.platform);
  // One client per network per run, so the config is fetched once.
  const clients = new Map<string, TurbineApi>();
  const api = () => {
    const current = network();
    let client = clients.get(current.name);
    if (!client) {
      client = (io.api ?? ((n) => createHttpApi({ network: n })))(current);
      clients.set(current.name, client);
    }
    return client;
  };
  const walletContext = (): WalletContext & { prompter?: Prompter } => ({
    dirs: dirs(),
    sources: {
      file: options().passwordFile,
      env: env().walletPassword,
      prompter: io.prompter,
      tty: io.interactive,
      platform: io.platform,
    },
    prompter: io.prompter,
    addSecret: (secret) => secrets.push(secret),
    scryptN: io.scryptN,
  });

  const showConfig = () => {
    const explicit = options().account ?? env().account;
    let wallet: WalletRef | undefined;
    try {
      wallet = findWallet(explicit ?? "default", dirs());
    } catch (error) {
      // No wallet yet is a normal state to report; a wallet asked for by name must exist.
      if (explicit !== undefined) throw error;
    }
    const report = configReport(network(), wallet);
    output.result(report, (theme) => renderConfig(report, theme));
  };
  const newWallet = async (name: string) => {
    const created = await walletNew(name, walletContext());
    output.result(created, (theme) => renderCreated(created, theme));
  };
  const importWallet = async (name: string) => {
    const created = await walletImport(name, walletContext());
    output.result(created, (theme) => renderCreated(created, theme));
  };
  const listWallets = () => {
    const entries = walletList(dirs());
    output.result(entries, (theme) => renderList(entries, theme));
  };

  const chain = () =>
    (io.chain ?? ((n) => createChain({ rpcUrl: n.rpcUrl })))(network());
  // The SDK loads only when a command signs: every other command starts fast without it, and runs from
  // source too (Node can't strip types inside node_modules, where the SDK keeps its TypeScript).
  const orders = io.orders ?? {
    listOrders: async (...args: Parameters<typeof listOrders>) =>
      (await import("./turbine/sdk-orders.ts")).listOrders(...args),
    // One connection per watch: the reader is opened on first use, from the lazily loaded SDK.
    openOrderReader: (...args: Parameters<typeof openOrderReader>) => {
      const reader = import("./turbine/sdk-orders.ts").then((sdk) =>
        sdk.openOrderReader(...args)
      );
      return { list: async (query) => (await reader).list(query) };
    },
    submitOrder: async (...args: Parameters<typeof submitOrder>) =>
      (await import("./turbine/sdk-orders.ts")).submitOrder(...args),
    submitCancel: async (...args: Parameters<typeof submitCancel>) =>
      (await import("./turbine/sdk-orders.ts")).submitCancel(...args),
  };
  const now = io.now ?? (() => Math.floor(Date.now() / 1000));
  // The wallet that signs: --account, TURBINE_ACCOUNT, or "default". Its address is read from the
  // keystore without unlocking it, so --dry-run never needs the password.
  const signingWallet = () => {
    const name = options().account ?? env().account ?? "default";
    let ref: WalletRef;
    try {
      ref = findWallet(name, dirs());
    } catch (error) {
      if (
        error instanceof CliError &&
        error.code === "WALLET_NOT_FOUND" &&
        name === "default"
      )
        throw new CliError("WALLET_NONE");
      throw error;
    }
    if (!ref.address)
      throw new CliError("WALLET_FILE_INVALID", { path: ref.path });
    const address: Hex = ref.address;
    const unlock = async () => {
      const unlocked = await unlockWallet(ref, walletContext().sources);
      secrets.push(...unlocked.secrets);
      return unlocked;
    };
    return { name: ref.name, address, unlock };
  };
  const confirm = (message: string) =>
    io.prompter ? io.prompter.confirm(message) : Promise.resolve(undefined);

  const placeOrder = async (input: {
    amount: string;
    sell: string;
    buy: string;
    spreadBps: number;
    ttl: string;
    limit?: string;
  }) => {
    const wallet = signingWallet();
    const result = await placeCommand(input, {
      api: api(),
      chain: chain().reader,
      network: network(),
      wallet: { name: wallet.name, address: wallet.address },
      dryRun: options().dryRun === true,
      yes: options().yes === true,
      interactive: io.interactive,
      now,
      note: (summary) => output.note(renderSummary(summary, output.theme)),
      confirm,
      unlock: wallet.unlock,
      submit: orders.submitOrder,
    });
    output.result(result, (theme) => renderPlaced(result, theme));
  };
  const approve = async (token: string, amount?: string) => {
    const wallet = signingWallet();
    const { reader, writer } = chain();
    const result = await approveCommand(
      { token, ...(amount === undefined ? {} : { amount }) },
      {
        api: api(),
        reader,
        writer,
        wallet: { name: wallet.name, address: wallet.address },
        dryRun: options().dryRun === true,
        yes: options().yes === true,
        interactive: io.interactive,
        confirm,
        unlock: wallet.unlock,
      }
    );
    output.result(result, (theme) => renderApprove(result, theme));
  };

  const showOrders = async (filters: { status?: string; max?: string }) => {
    const statuses = filters.status ? parseStatuses(filters.status) : undefined;
    const max = filters.max === undefined ? 20 : Number(filters.max);
    if (!Number.isInteger(max) || max < 1 || max > 200)
      throw new CliError("USAGE_INVALID_VALUE", { option: "--max" });
    const wallet = signingWallet();
    const info = await api().info();
    const { account } = await wallet.unlock();
    if (account.address.toLowerCase() !== wallet.address.toLowerCase())
      throw new CliError("WALLET_ADDRESS_MISMATCH");
    const states = await orders.listOrders(
      account,
      info.settler,
      { ...(statuses ? { statuses } : {}), limit: max },
      { network: network() }
    );
    const reports = states.map((o) => orderReport(o, info.tokens, now()));
    output.result(reports, (theme) => renderOrders(reports, theme));
  };
  const watch = async (hashText: string) => {
    const hash = checkHash(hashText);
    const wallet = signingWallet();
    const info = await api().info();
    const { account } = await wallet.unlock();
    if (account.address.toLowerCase() !== wallet.address.toLowerCase())
      throw new CliError("WALLET_ADDRESS_MISMATCH");
    const reader = orders.openOrderReader(account, info.settler, {
      network: network(),
    });
    const fetchState = async () => {
      const [state] = await reader.list({ hashes: [hash] });
      if (!state) throw new CliError("ORDER_NOT_FOUND");
      return orderReport(state, info.tokens, now());
    };
    const first = await fetchState();
    const sell = info.tokens.find((t) => t.address === first.sell?.address);
    const buy = info.tokens.find((t) => t.address === first.buy?.address);
    // The mid for one whole sell token: the price, not this order's amounts.
    const fetchMid = async () =>
      sell && buy
        ? priceOf(
            (
              await api().quote(
                sell.address,
                buy.address,
                10n ** BigInt(sell.decimals)
              )
            ).mid,
            sell.decimals,
            buy.decimals
          )
        : null;
    const terminal = detectTerminal(io.stdoutInfo, io.env, { motion: true });
    // The live view needs the keyboard as well as the screen: stdin must be a terminal too.
    const mode = output.json
      ? "json"
      : terminal.tty && io.interactive && io.keys
        ? "screen"
        : "lines";
    let pending: typeof first | undefined = first;
    if (mode === "screen") {
      // The alternate screen keeps the shell's scrollback; the summary goes to the normal one after.
      io.stdout("\u001b[?1049h");
      io.cursor?.hide();
    }
    let outcome;
    try {
      outcome = await watchOrder({
        fetchState: () => {
          const ready = pending;
          pending = undefined;
          return ready ? Promise.resolve(ready) : fetchState();
        },
        fetchMid,
        sleep:
          io.sleep ??
          ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
        ...(mode === "screen" && io.keys ? { onKey: io.keys } : {}),
        mode,
        write: io.stdout,
        theme: output.theme,
        width: () => io.stdoutInfo.columns || 80,
        now,
      });
    } finally {
      if (mode === "screen") {
        io.cursor?.show();
        io.stdout("\u001b[?1049l");
      }
    }
    if (outcome.kind === "cancel") {
      // A single keypress shouldn't cancel without a word: ask, whatever the network.
      const sure = await confirm(`Cancel order ${hash}?`);
      if (sure !== true) return;
      return cancelOrder(hash, account);
    }
    if (outcome.kind === "interrupted") throw new CliError("CANCELLED");
    if (mode === "screen")
      output.note(
        outcome.kind === "done"
          ? `Order ${hash} is ${outcome.status.toLowerCase()}.`
          : `Stopped watching ${hash}; the order carries on.`
      );
  };

  const cancelOrder = async (hash: string, unlocked?: Unlocked["account"]) => {
    const wallet = signingWallet();
    const result = await cancelCommand(hash, {
      network: network(),
      wallet: { address: wallet.address },
      settler: async () => (await api().info()).settler,
      dryRun: options().dryRun === true,
      yes: options().yes === true,
      interactive: io.interactive,
      confirm,
      // From the watch view the wallet is already unlocked; don't ask for the password again.
      unlock: unlocked
        ? () => Promise.resolve({ account: unlocked, secrets: [] })
        : wallet.unlock,
      submit: orders.submitCancel,
    });
    output.result(result, (theme) => renderCancel(result, theme));
  };

  const showTokens = async () => {
    const tokens = await tokensCommand(api());
    output.result(tokens, (theme) => renderTokens(tokens, theme));
  };
  const showQuote = async (input: {
    amount: string;
    sell: string;
    buy: string;
    spreadBps?: number;
  }) => {
    const report = await quoteCommand(input, api(), network().name);
    output.result(report, (theme) => renderQuote(report, theme));
  };
  const ask = async (prompter: Prompter, message: string, initial = "") => {
    const answer = await prompter.text(message, initial);
    if (answer === undefined) throw new CliError("CANCELLED");
    return answer.trim();
  };

  const askName = async (prompter: Prompter) => {
    const name = await prompter.text("Name for the wallet", "default");
    if (name === undefined) throw new CliError("CANCELLED");
    return name.trim() || "default";
  };

  const session = (prompter: Prompter) =>
    runSession({
      prompter,
      header: () => {
        const terminal = detectTerminal(io.stdoutInfo, io.env, {
          motion: options().motion,
        });
        return playHeader({
          write: io.stdout,
          size: headerSize(terminal.width),
          theme: output.theme,
          network: network().name,
          motion: terminal.motion,
          cursor: io.cursor,
        });
      },
      actions: () => [
        {
          value: "quote",
          label: "Get a quote",
          hint: "mid price, fee, what a spread means",
          run: async () => {
            const amount = await ask(prompter, "How much do you sell?", "1");
            const sell = await ask(
              prompter,
              "Which token do you sell?",
              "WETH"
            );
            const buy = await ask(prompter, "For which token?", "USDC");
            const spread = await ask(
              prompter,
              "Spread in basis points (blank for none)",
              ""
            );
            await showQuote({
              amount,
              sell,
              buy,
              ...(spread ? { spreadBps: parseBps(spread) } : {}),
            });
          },
        },
        {
          value: "place",
          label: "Place an order",
          hint: "a spread order that tracks the mid price",
          run: async () => {
            const amount = await ask(prompter, "How much do you sell?", "1");
            const sell = await ask(
              prompter,
              "Which token do you sell?",
              "WETH"
            );
            const buy = await ask(prompter, "For which token?", "USDC");
            const spread = await ask(prompter, "Spread in basis points", "20");
            const ttl = await ask(
              prompter,
              "How long should it live? (e.g. 30m, 4h)",
              "1h"
            );
            const limit = await ask(
              prompter,
              "Limit price (blank for none)",
              ""
            );
            await placeOrder({
              amount,
              sell,
              buy,
              spreadBps: parseBps(spread),
              ttl,
              ...(limit ? { limit } : {}),
            });
          },
        },
        {
          value: "approve",
          label: "Approve a token",
          hint: "once per token, an Ethereum transaction",
          run: async () => approve(await ask(prompter, "Which token?", "WETH")),
        },
        { value: "orders", label: "My orders", run: () => showOrders({}) },
        {
          value: "watch",
          label: "Watch an order",
          run: async () => watch(await ask(prompter, "Order hash (0x…)", "")),
        },
        {
          value: "cancel",
          label: "Cancel an order",
          run: async () =>
            cancelOrder(await ask(prompter, "Order hash (0x…)", "")),
        },
        { value: "tokens", label: "Supported tokens", run: showTokens },
        {
          value: "config",
          label: "Show my setup",
          run: () => Promise.resolve(showConfig()),
        },
        {
          value: "wallets",
          label: "My wallets",
          run: () => Promise.resolve(listWallets()),
        },
        {
          value: "wallet-new",
          label: "Create a wallet",
          run: async () => newWallet(await askName(prompter)),
        },
        {
          value: "wallet-import",
          label: "Import a wallet",
          hint: "private key, typed hidden",
          run: async () => importWallet(await askName(prompter)),
        },
        // A network given on the command line is fixed for the session.
        ...(options().network === undefined
          ? [
              {
                value: "network",
                label: "Switch network",
                hint: `now ${network().name}`,
                run: async () => {
                  const choice = await prompter.choose("Which network?", [
                    {
                      value: "playground",
                      label: "playground",
                      hint: "simulated, no real funds",
                    },
                    { value: "mainnet", label: "mainnet", hint: "real funds" },
                  ]);
                  if (choice === "mainnet") {
                    const sure = await prompter.confirm(
                      "Use mainnet? Orders there trade real funds."
                    );
                    if (sure !== true) return;
                  }
                  if (choice) sessionNetwork = choice;
                  output.note(output.theme.dim(`Network: ${network().name}`));
                },
              },
            ]
          : []),
      ],
      fail: (error) => {
        // Cancelling a question just returns to the menu.
        if (error instanceof CliError && error.code === "CANCELLED") return;
        output.fail(error);
      },
      goodbye: () => output.note(output.theme.dim("Trade slow, pay less.")),
    });

  program
    .command("tokens")
    .description("the tokens Turbine supports on this network")
    .action(showTokens);

  program
    .command("quote")
    .description(
      "the mid price for a pair, Turbine's fee, and what a spread would mean"
    )
    .argument("<amount>", "how much you sell, e.g. 1.5")
    .argument("<sell>", "the token you sell, e.g. WETH")
    .argument("<buy>", "the token you buy, e.g. USDC")
    .option(
      "--spread <bps>",
      "a spread in basis points: 50 is up to 0.5% worse than mid, -10 only better"
    )
    .action(async (amount, sell, buy, opts) => {
      await showQuote({
        amount,
        sell,
        buy,
        ...(opts.spread === undefined
          ? {}
          : { spreadBps: parseBps(opts.spread) }),
      });
    });

  program
    .command("approve")
    .description(
      "let Permit2 move a token you sell (once per token; an Ethereum transaction)"
    )
    .argument("<token>", "the token, e.g. WETH")
    .option("--amount <amount>", "approve only this much (default: unlimited)")
    .action((token, opts) => approve(token, opts.amount));

  program
    .command("orders")
    .description("the wallet's orders, newest first")
    .option(
      "--status <list>",
      "only these: active, filled, expired, cancelled, cancelling, invalid"
    )
    .option("--max <n>", "at most this many (1–200, default 20)")
    .action(showOrders);

  const order = program
    .command("order")
    .description("place, watch and cancel orders");
  order
    .command("watch")
    .description("follow an order live until it is done")
    .argument("<hash>", "the order's hash, from turbine orders")
    .action(watch);
  order
    .command("cancel")
    .description(
      "cancel an order (Turbine applies it after the Speedbump, about 12 s)"
    )
    .argument("<hash>", "the order's hash, from turbine orders")
    // Wrapped: commander passes its options as a second argument, which isn't an unlocked wallet.
    .action((hash) => cancelOrder(hash));
  order
    .command("place")
    .description("place a spread order that tracks the mid price")
    .argument("<amount>", "how much you sell, e.g. 1.5")
    .argument("<token>", "the token you sell, e.g. WETH")
    .requiredOption("--for <token>", "the token you buy, e.g. USDC")
    .requiredOption(
      "--spread <bps>",
      "basis points from mid: 20 is up to 0.2% worse, -10 only better"
    )
    .requiredOption("--ttl <duration>", "how long it lives, e.g. 30m, 4h, 2d")
    .option("--limit <price>", "never trade below this price (buy per sell)")
    .action((amount, token, opts) =>
      placeOrder({
        amount,
        sell: token,
        buy: opts.for,
        spreadBps: parseBps(opts.spread),
        ttl: opts.ttl,
        ...(opts.limit === undefined ? {} : { limit: opts.limit }),
      })
    );

  program
    .command("config")
    .description("show the network, API and wallet turbine-cli will use")
    .action(showConfig);

  const wallet = program
    .command("wallet")
    .description("create, import and list encrypted wallets");
  wallet
    .command("new")
    .description("create a new wallet, encrypted with a password")
    .argument("[name]", "a name for it", "default")
    .action(newWallet);
  wallet
    .command("import")
    .description(
      "bring a wallet you have, typing its private key into a hidden prompt"
    )
    .argument("[name]", "a name for it", "default")
    .action(importWallet);
  wallet
    .command("list")
    .description("list wallets, including Foundry keystores")
    .action(listWallets);

  return program;
}

async function run(argv: string[], io: Io): Promise<number> {
  // Read before parsing, because a usage error must already come out in the right format.
  const json = argv.includes("--json");
  const debug = argv.includes("--debug");
  const terminal = detectTerminal(io.stdoutInfo, io.env, {
    motion: !argv.includes("--no-motion"),
  });
  const secrets: string[] = [];
  const output = createOutput({
    json,
    debug,
    theme: createTheme(terminal.color),
    stdout: io.stdout,
    stderr: io.stderr,
    secrets: () => secrets,
  });
  // A key typed as an argument is already in the shell's history; refuse it before anything else
  // can echo it, and say what to do.
  if (argv.some((arg, i) => KEY_SHAPED.test(arg) && !isOrderHash(argv, i)))
    return output.fail(new CliError("KEY_IN_ARGV"));
  const captured: Captured = { text: "" };
  try {
    await buildProgram(io, output, secrets, captured).parseAsync(argv, {
      from: "user",
    });
    return 0;
  } catch (error) {
    if (isCommanderError(error)) {
      if (CLEAN_EXITS.has(error.code)) {
        if (json) {
          const data =
            error.code === "commander.version"
              ? { version: pkg.version }
              : { help: captured.text };
          output.result(data, () => "");
        }
        return 0;
      }
      return output.fail(usageError(error));
    }
    return output.fail(error);
  }
}

export { run };
export type { Io };
