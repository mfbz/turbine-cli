import { parseArgs } from "node:util";

import pkg from "../package.json" with { type: "json" };

type Output = { out: (text: string) => void; err: (text: string) => void };

const USAGE = `turbine: an unofficial command line for Turbine, the private orderbook on Ethereum.

Usage
  turbine [options]

Options
  -v, --version  print the version
  -h, --help     print this help
`;

function run(argv: string[], output: Output): number {
  let values: { version?: boolean; help?: boolean };
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        version: { type: "boolean", short: "v" },
        help: { type: "boolean", short: "h" },
      },
      strict: true,
    }));
  } catch (error) {
    // parseArgs names the offending flag; usage goes with it to stderr so stdout stays clean for pipes.
    const reason = error instanceof Error ? error.message : String(error);
    output.err(`${reason}\n\n${USAGE}`);
    return 2;
  }
  if (values.version) {
    output.out(`${pkg.version}\n`);
    return 0;
  }
  output.out(USAGE);
  return 0;
}

export { run };
export type { Output };
