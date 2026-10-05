// Every message turbine-cli shows comes from this catalogue. Nothing else is ever printed as an error:
// not a library's message, not the Turbine API's text, not what was typed. Agents branch on `code`;
// `message` and `hint` are ours, so they are safe to show to a person and to put in an agent's context.

type ExitCode = 1 | 2 | 130;
type Entry = {
  exit: ExitCode;
  retryable: boolean;
  message: string;
  hint: string;
};
type Params = Readonly<Record<string, string>>;
type ErrorReport = {
  code: string;
  message: string;
  hint: string;
  retryable: boolean;
  upstreamCode?: string;
};
type DebugInfo = { className: string; frames: string[] };
type FullReport = ErrorReport & { exitCode: ExitCode; debug?: DebugInfo };

const entry = (
  exit: ExitCode,
  message: string,
  hint: string,
  retryable = false
): Entry => ({ exit, retryable, message, hint });

const CATALOGUE = {
  USAGE: entry(2, "That command isn't valid.", "See turbine --help."),
  USAGE_UNKNOWN_COMMAND: entry(
    2,
    "There is no command {command}.",
    "See turbine --help for the commands."
  ),
  USAGE_UNKNOWN_OPTION: entry(
    2,
    "There is no option {option} here.",
    "See turbine --help, or --help after the command."
  ),
  USAGE_MISSING_ARGUMENT: entry(
    2,
    "Something this command needs is missing.",
    "See --help after the command."
  ),
  USAGE_INVALID_VALUE: entry(
    2,
    "The value for {option} isn't valid.",
    "See --help after the command."
  ),
  KEY_IN_ARGV: entry(
    2,
    "That looks like a private key on the command line. turbine-cli never takes a key that way.",
    "It may now be in your shell history: remove it there. If the wallet holds funds, move them. To add a wallet: turbine wallet import."
  ),
  NETWORK_UNKNOWN: entry(
    2,
    "There is no network {network}.",
    "Use --network playground or --network mainnet."
  ),
  MAINNET_NEEDS_FLAG: entry(
    1,
    "TURBINE_NETWORK=mainnet is set, but mainnet is only used when the command asks for it.",
    "Add --network mainnet to the command, or unset TURBINE_NETWORK."
  ),
  CONFIG_INVALID: entry(
    1,
    "{variable} isn't valid.",
    "Fix it in your shell (see .env.example for every setting)."
  ),
  API_URL_NOT_ALLOWED: entry(
    1,
    "TURBINE_API_URL may only point at this computer, and never on mainnet.",
    "The API decides which contracts your wallet signs for. Unset TURBINE_API_URL to use Turbine's own."
  ),
  WALLET_NONE: entry(
    1,
    "There is no wallet yet.",
    "Create one with turbine wallet new, or bring yours with turbine wallet import."
  ),
  WALLET_NOT_FOUND: entry(
    1,
    'There is no wallet named "{name}".',
    "See turbine wallet list. Foundry keystores in ~/.foundry/keystores work too."
  ),
  WALLET_EXISTS: entry(
    1,
    'A wallet named "{name}" already exists.',
    "Choose another name, or remove the old file yourself if you're sure."
  ),
  WALLET_NAME_INVALID: entry(
    2,
    "Wallet names use letters, digits, - and _ (up to 32).",
    "For example: turbine wallet new trading"
  ),
  WALLET_STORAGE_FAILED: entry(
    1,
    "Can't use the wallets folder {path}.",
    "Check it is a folder you own (not a link to somewhere else) and that you can write to it."
  ),
  WALLET_FILE_TOO_OPEN: entry(
    1,
    "The wallet file {path} can be read by other users of this computer.",
    "Make it yours only: chmod 600 {path}"
  ),
  WALLET_FILE_INVALID: entry(
    1,
    "The wallet file {path} isn't a keystore turbine-cli can read.",
    "turbine-cli reads standard encrypted keystores (Web3 Secret Storage v3), as written by turbine wallet, Foundry or geth."
  ),
  PASSWORD_REQUIRED: entry(
    1,
    "A wallet password is needed and there is no terminal to ask for it.",
    "Give the password with --password-file <file> or TURBINE_WALLET_PASSWORD in your shell."
  ),
  WALLET_PASSWORD_WRONG: entry(
    1,
    "That password doesn't unlock the wallet.",
    "Try again. turbine-cli can't recover a forgotten password."
  ),
  PASSWORD_FILE_UNREADABLE: entry(
    1,
    "Can't read the password file {path}.",
    "Check --password-file points at a file you can read."
  ),
  PASSWORD_FILE_TOO_OPEN: entry(
    1,
    "The password file {path} can be read by other users of this computer.",
    "Make it yours only: chmod 600 {path}"
  ),
  PASSWORD_TOO_SHORT: entry(
    1,
    "The password is too short.",
    "Use at least 8 characters; a passphrase of a few words is best."
  ),
  PASSWORDS_DIFFER: entry(
    1,
    "The two passwords don't match.",
    "Run the command again."
  ),
  KEY_INVALID: entry(
    1,
    "That isn't a valid Ethereum private key.",
    "A private key is 64 hexadecimal characters, with or without 0x."
  ),
  TERMINAL_REQUIRED: entry(
    1,
    "This needs a terminal to ask you something privately.",
    "Run it in a terminal yourself; this step is never automated."
  ),
  CANCELLED: entry(130, "Cancelled.", "Nothing was changed."),
  SERVICE_UNAVAILABLE: entry(
    1,
    "Turbine is unavailable right now.",
    "Try again in a minute. The playground and mainnet are separate: --network picks one.",
    true
  ),
  API_REJECTED: entry(
    1,
    "Turbine rejected the request.",
    "Run again with --debug to see the request's route and status."
  ),
  INTERNAL: entry(
    1,
    "Something went wrong inside turbine-cli.",
    "Run again with --debug and report it with that output at github.com/mfbz/turbine-cli/issues."
  ),
} satisfies Record<string, Entry>;

type ErrorCode = keyof typeof CATALOGUE;

// Turbine API error codes with words of our own; any other code becomes API_REJECTED.
const UPSTREAM: Readonly<Record<string, ErrorCode>> = {
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
};
// What a filled-in parameter may look like: a name, a path, a word. Anything else becomes "…".
const SAFE_PARAM = /^[A-Za-z0-9 _.,:/~@+=-]{1,80}$/;
const KEY_SHAPED = /[0-9a-fA-F]{40,}/;
const SAFE_UPSTREAM_CODE = /^[A-Z0-9_]{1,64}$/;

class CliError extends Error {
  readonly code: ErrorCode;
  readonly params: Params;

  constructor(
    code: ErrorCode,
    params: Params = {},
    options?: { cause?: unknown }
  ) {
    // The message is ours and contains no parameters, so it is safe wherever it ends up.
    super(CATALOGUE[code].message, options);
    this.name = "CliError";
    this.code = code;
    this.params = params;
  }
}

function safeParam(value: string): string {
  return SAFE_PARAM.test(value) && !KEY_SHAPED.test(value) ? value : "…";
}

function fill(template: string, params: Params): string {
  return template.replace(/\{(\w+)\}/g, (_match, name: string) =>
    safeParam(params[name] ?? "")
  );
}

function report(code: ErrorCode, params: Params = {}): FullReport {
  const { exit, retryable, message, hint } = CATALOGUE[code];
  return {
    code,
    message: fill(message, params),
    hint: fill(hint, params),
    retryable,
    exitCode: exit,
  };
}

// The SDK's TurbineError, by shape so this module needn't import the SDK. Other errors with a code
// (Node's ENOTDIR, ERR_CRYPTO_*) are not Turbine's and must never read as "Turbine rejected".
function isTurbineError(value: unknown): value is { code: string } {
  return (
    value instanceof Error &&
    value.name === "TurbineError" &&
    typeof (value as { code?: unknown }).code === "string"
  );
}

// Class name and stack frames only: frames hold file names and line numbers, never values.
function debugInfo(error: unknown): DebugInfo {
  const className =
    error instanceof Error ? error.constructor.name : typeof error;
  const frames =
    error instanceof Error && error.stack
      ? error.stack
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.startsWith("at "))
          .slice(0, 12)
      : [];
  return { className, frames };
}

function toErrorReport(error: unknown): FullReport {
  let full: FullReport;
  if (error instanceof CliError) {
    full = report(error.code, error.params);
  } else if (isTurbineError(error)) {
    const known = UPSTREAM[error.code];
    full = known ? report(known) : report("API_REJECTED");
    if (!known && SAFE_UPSTREAM_CODE.test(error.code))
      full.upstreamCode = error.code;
  } else {
    full = report("INTERNAL");
  }
  if (!(error instanceof CliError)) full.debug = debugInfo(error);
  return full;
}

export { CATALOGUE, CliError, toErrorReport };
export type { DebugInfo, ErrorCode, ErrorReport, ExitCode };
