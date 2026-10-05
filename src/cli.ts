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
import { CliError } from "./output/errors.ts";
import type { ErrorCode } from "./output/errors.ts";
import { createOutput } from "./output/output.ts";
import type { Output, Writer } from "./output/output.ts";
import { detectTerminal } from "./output/terminal.ts";
import type { StreamLike } from "./output/terminal.ts";
import { createTheme } from "./output/theme.ts";
import type { Cursor } from "./ui/cursor.ts";
import { headerSize, playHeader } from "./ui/header.ts";
import type { Prompter } from "./wallet/signer.ts";
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
};
type GlobalOptions = {
  network?: string;
  account?: string;
  passwordFile?: string;
  motion: boolean;
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
  if (argv.some((arg) => KEY_SHAPED.test(arg)))
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
