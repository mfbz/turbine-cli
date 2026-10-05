import { Command, CommanderError, Option } from "@commander-js/extra-typings";

import pkg from "../package.json" with { type: "json" };
import { configReport, renderConfig } from "./commands/config.ts";
import { loadEnv } from "./config/env.ts";
import { resolveNetwork } from "./config/network.ts";
import { CliError } from "./output/errors.ts";
import { createOutput } from "./output/output.ts";
import type { Output, Writer } from "./output/output.ts";
import { detectTerminal } from "./output/terminal.ts";
import type { StreamLike } from "./output/terminal.ts";
import { createTheme } from "./output/theme.ts";
import { loadKey } from "./wallet/key.ts";
import type { KeyFs } from "./wallet/key.ts";

type Io = {
  stdout: Writer;
  stderr: Writer;
  env: Record<string, string | undefined>;
  cwd: string;
  stdoutInfo: StreamLike;
  keyFs: KeyFs;
};
type GlobalOptions = { network?: string };

// Commander's own outcomes that aren't failures.
const CLEAN_EXITS = new Set([
  "commander.helpDisplayed",
  "commander.version",
  "commander.help",
]);

function buildProgram(io: Io, output: Output, secrets: string[]) {
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
    .option("--json", "machine output: one JSON document on stdout")
    .option("--dry-run", "show what would be signed and sent, then stop")
    .option(
      "-y, --yes",
      "skip confirmations (mainnet needs it without a terminal)"
    )
    .option("--no-motion", "no animation")
    .option("--debug", "show details when something fails")
    .argument("[command]")
    .exitOverride()
    .configureOutput({
      writeOut: io.stdout,
      // Usage errors are reported by output.fail, in the right format for --json or a person.
      writeErr: () => {},
      outputError: () => {},
    })
    .action((command) => {
      if (command !== undefined) {
        throw new CliError("USAGE", `Unknown command "${command}".`, {
          hint: "See turbine --help.",
          exitCode: 2,
        });
      }
      // No command: the interactive session will open here; until then, help.
      io.stdout(program.helpInformation());
    });

  program
    .command("config")
    .description("show the network, API and wallet turbine-cli will use")
    .action(() => {
      const options: GlobalOptions = program.opts();
      const env = loadEnv({ env: io.env, cwd: io.cwd });
      const network = resolveNetwork({ flag: options.network, env });
      const key = loadKey(env, io.keyFs);
      if (key) secrets.push(key.privateKey);
      const report = configReport(network, key);
      output.result(report, (theme) => renderConfig(report, theme));
    });

  return program;
}

function usageError(error: CommanderError): CliError {
  const message = error.message.replace(/^error: /, "");
  return new CliError(
    "USAGE",
    `${message.charAt(0).toUpperCase()}${message.slice(1)}`,
    {
      hint: "See turbine --help.",
      exitCode: 2,
    }
  );
}

async function run(argv: string[], io: Io): Promise<number> {
  // Read before parsing, because a usage error must already come out in the right format.
  const json = argv.includes("--json");
  const debug = argv.includes("--debug");
  const terminal = detectTerminal(io.stdoutInfo, io.env, {
    motion: !argv.includes("--no-motion"),
  });
  // The raw variable is redacted from the start, before it is even validated.
  const raw = io.env.TURBINE_PRIVATE_KEY?.trim();
  const secrets: string[] = raw ? [raw] : [];
  const output = createOutput({
    json,
    debug,
    theme: createTheme(terminal.color),
    stdout: io.stdout,
    stderr: io.stderr,
    secrets: () => secrets,
  });
  try {
    await buildProgram(io, output, secrets).parseAsync(argv, { from: "user" });
    return 0;
  } catch (error) {
    if (error instanceof CommanderError) {
      if (CLEAN_EXITS.has(error.code)) return 0;
      return output.fail(usageError(error));
    }
    return output.fail(error);
  }
}

export { run };
export type { Io };
