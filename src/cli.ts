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
import { loadEnv } from "./config/env.ts";
import type { Env } from "./config/env.ts";
import { resolveNetwork } from "./config/network.ts";
import { CliError } from "./output/errors.ts";
import type { ErrorCode } from "./output/errors.ts";
import { createOutput } from "./output/output.ts";
import type { Output, Writer } from "./output/output.ts";
import { detectTerminal } from "./output/terminal.ts";
import type { StreamLike } from "./output/terminal.ts";
import { createTheme } from "./output/theme.ts";
import type { PasswordSources, Prompter } from "./wallet/signer.ts";
import { findWallet, walletDirs } from "./wallet/store.ts";
import type { WalletRef } from "./wallet/store.ts";

type Io = {
  stdout: Writer;
  stderr: Writer;
  env: Record<string, string | undefined>;
  cwd: string;
  home: string;
  platform: NodeJS.Platform;
  stdoutInfo: StreamLike;
  // Both ends are a terminal: only then can turbine-cli ask anything privately.
  interactive: boolean;
  prompter?: Prompter;
  // Test-only: a cheaper scrypt cost for new wallets.
  scryptN?: number;
};
type GlobalOptions = {
  network?: string;
  account?: string;
  passwordFile?: string;
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
      // Usage errors are reported by output.fail, in the right format for --json or a person.
      writeErr: () => {},
      outputError: () => {},
    })
    .action((command) => {
      if (command !== undefined)
        throw new CliError("USAGE_UNKNOWN_COMMAND", { command });
      // No command: the interactive session will open here; until then, help.
      const help = program.helpInformation();
      output.result({ help }, () => help.trimEnd());
    });

  const env = (): Env => loadEnv({ env: io.env, cwd: io.cwd });
  const dirs = () => walletDirs(io.env, io.home, io.platform);
  const passwordSources = (
    options: GlobalOptions,
    e: Env
  ): PasswordSources => ({
    file: options.passwordFile,
    env: e.walletPassword,
    prompter: io.prompter,
    tty: io.interactive,
    platform: io.platform,
  });
  const walletContext = (): WalletContext & { prompter?: Prompter } => {
    const options: GlobalOptions = program.opts();
    const e = env();
    return {
      dirs: dirs(),
      sources: passwordSources(options, e),
      prompter: io.prompter,
      addSecret: (secret) => secrets.push(secret),
      scryptN: io.scryptN,
    };
  };

  program
    .command("config")
    .description("show the network, API and wallet turbine-cli will use")
    .action(() => {
      const options: GlobalOptions = program.opts();
      const e = env();
      const network = resolveNetwork({ flag: options.network, env: e });
      const explicit = options.account ?? e.account;
      let wallet: WalletRef | undefined;
      try {
        wallet = findWallet(explicit ?? "default", dirs());
      } catch (error) {
        // No wallet yet is a normal state to report; a wallet asked for by name must exist.
        if (explicit !== undefined) throw error;
      }
      const report = configReport(network, wallet);
      output.result(report, (theme) => renderConfig(report, theme));
    });

  const wallet = program
    .command("wallet")
    .description("create, import and list encrypted wallets");
  wallet
    .command("new")
    .description("create a new wallet, encrypted with a password")
    .argument("[name]", "a name for it", "default")
    .action(async (name) => {
      const created = await walletNew(name, walletContext());
      output.result(created, (theme) => renderCreated(created, theme));
    });
  wallet
    .command("import")
    .description(
      "bring a wallet you have, typing its private key into a hidden prompt"
    )
    .argument("[name]", "a name for it", "default")
    .action(async (name) => {
      const created = await walletImport(name, walletContext());
      output.result(created, (theme) => renderCreated(created, theme));
    });
  wallet
    .command("list")
    .description("list wallets, including Foundry keystores")
    .action(() => {
      const entries = walletList(dirs());
      output.result(entries, (theme) => renderList(entries, theme));
    });

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
