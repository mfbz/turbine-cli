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
  AMOUNT_INVALID: entry(
    2,
    "{amount} isn't an amount: use a positive number such as 10 or 0.5.",
    "Amounts are in whole tokens, with a dot for decimals."
  ),
  AMOUNT_TOO_PRECISE: entry(
    2,
    "That token has {decimals} decimals; the amount has more.",
    "Round the amount to the token's precision."
  ),
  SPREAD_INVALID: entry(
    2,
    "A spread is a whole number of basis points from -10000 to 9999.",
    "50 means up to 0.5% worse than mid; -10 means only 0.1% better than mid or more."
  ),
  DURATION_INVALID: entry(
    2,
    "{duration} isn't a duration.",
    "Use seconds, minutes, hours or days, such as 90s, 15m, 4h, 2d or 1h30m."
  ),
  TOKEN_UNKNOWN: entry(
    1,
    "Turbine doesn't trade {token} on this network.",
    "See turbine tokens for the tokens you can use."
  ),
  TOKEN_AMBIGUOUS: entry(
    1,
    "More than one token on this network is called {token}.",
    "Use the token's address instead; turbine tokens lists them."
  ),
  SAME_TOKEN: entry(
    2,
    "The sell and buy tokens are the same.",
    "Pick two different tokens."
  ),
  NETWORK_UNREACHABLE: entry(
    1,
    "Couldn't reach Turbine.",
    "Check your connection and try again.",
    true
  ),
  QUOTE_UNAVAILABLE: entry(
    1,
    "Quoting is switched off on this network right now.",
    "Try again later, or the other network with --network.",
    true
  ),
  API_RESPONSE_INVALID: entry(
    1,
    "Turbine answered in a way turbine-cli doesn't understand.",
    "Turbine's API may have changed. Update turbine-cli, or report it with the output of --debug."
  ),
  API_CONTRACTS_UNEXPECTED: entry(
    1,
    "Turbine's API names contracts other than the ones Turbine publishes for mainnet.",
    "turbine-cli won't sign for unknown contracts. Check docs.turbine.exchange and update turbine-cli."
  ),
  STATUS_UNKNOWN: entry(
    2,
    "There is no order status {status}.",
    "Use active, filled, expired, cancelled, cancelling or invalid, separated by commas."
  ),
  ORDER_NOT_FOUND: entry(
    1,
    "This wallet has no order with that hash on this network.",
    "Check the hash and --network; turbine orders lists yours."
  ),
  HASH_INVALID: entry(
    2,
    "That isn't an order hash.",
    "An order hash is 0x followed by 64 hexadecimal characters; turbine orders lists yours."
  ),
  TTL_TOO_LONG: entry(
    2,
    "An order can live 30 days at most.",
    "Its Permit2 allowance lasts as long as the order; place a new one later if you need to."
  ),
  ORDER_OUTCOME_UNKNOWN: entry(
    1,
    "The order was signed and sent, but turbine-cli couldn't confirm Turbine took it.",
    "It may be placed. Check with turbine orders before placing it again."
  ),
  CANCEL_OUTCOME_UNKNOWN: entry(
    1,
    "The cancel was signed and sent, but turbine-cli couldn't confirm Turbine took it.",
    "Check the order with turbine orders before cancelling again."
  ),
  APPROVAL_PARTIAL: entry(
    1,
    "Only the first of two approval transactions went through ({hash}).",
    "USDT needs its allowance reset to zero first; that part is done. Run turbine approve USDT again to finish."
  ),
  TTL_TOO_SHORT: entry(
    2,
    "An order must live at least 24 seconds.",
    "Turbine delays every action by about 12 s (the Speedbump); use --ttl 1m or more."
  ),
  LIMIT_INVALID: entry(
    2,
    "A limit is a positive price in buy tokens per sell token, such as 2400.",
    "For example: --limit 2400 means never less than 2400 USDC per WETH."
  ),
  AMOUNT_TOO_SMALL: entry(
    1,
    "Turbine's smallest trade is worth {minimum} USDC.",
    "Trade a larger amount."
  ),
  ALLOWANCE_MISSING: entry(
    1,
    "Permit2 isn't approved to move your {token} yet.",
    "Approve it once with: turbine approve {token}"
  ),
  BALANCE_TOO_LOW: entry(
    1,
    "This wallet doesn't hold enough {token}.",
    "Check the amount, or fund the wallet first."
  ),
  ETH_TOO_LOW: entry(
    1,
    "This wallet doesn't have enough ETH to pay for the transaction's gas.",
    "Send a little ETH to the wallet first (turbine config shows its address)."
  ),
  TRANSACTION_REVERTED: entry(
    1,
    "The transaction {hash} failed on Ethereum.",
    "Nothing was approved. Check the token on a block explorer, then try again."
  ),
  TRANSACTION_PENDING: entry(
    1,
    "The transaction {hash} was sent but isn't confirmed yet.",
    "Check it on a block explorer; don't send it again until it's settled.",
    true
  ),
  CONFIRMATION_REQUIRED: entry(
    1,
    "This needs a confirmation and there is no terminal to ask in.",
    "Check it with --dry-run first, then run it again with --yes."
  ),
  WALLET_ADDRESS_MISMATCH: entry(
    1,
    "The unlocked key doesn't belong to the address this wallet file declares.",
    "The wallet file may have been changed. Nothing was signed; import the wallet again."
  ),
  SERVICE_BUSY: entry(
    1,
    "Turbine's orderbook is full right now.",
    "Try again in a few minutes.",
    true
  ),
  ORDER_LIMIT_REACHED: entry(
    1,
    "This wallet already has the most active orders Turbine allows (80).",
    "Cancel some with turbine order cancel <hash>, or wait for them to fill or expire."
  ),
  REQUEST_FAILED: entry(
    1,
    "The request didn't complete: Turbine or the Ethereum RPC may be unreachable.",
    "Try again. If it keeps failing, set TURBINE_RPC_URL to an Ethereum RPC you trust, or run with --debug.",
    true
  ),
  RPC_UNREACHABLE: entry(
    1,
    "Couldn't read from Ethereum.",
    "Try again, or set TURBINE_RPC_URL to an Ethereum RPC you trust.",
    true
  ),
  SERVICE_UNAVAILABLE: entry(
    1,
    "Turbine is unavailable right now.",
    "Try again in a minute. The playground and mainnet are separate: --network picks one.",
    true
  ),
  API_REJECTED: entry(
    1,
    "Turbine rejected the request.",
    "Turbine's code (in brackets, or upstreamCode in --json) says why. Check the amount, the tokens and the network; docs.turbine.exchange lists Turbine's limits."
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
  CONFIG_FETCH_FAILED: "SERVICE_UNAVAILABLE",
  ORDERBOOK_CAPACITY_ERROR: "SERVICE_BUSY",
  USER_ORDER_LIMIT_REACHED: "ORDER_LIMIT_REACHED",
  // The SDK's catch-all: it wraps RPC failures and dropped connections as well as its own bugs.
  UNKNOWN_ERROR: "REQUEST_FAILED",
  SDK_ERROR: "REQUEST_FAILED",
  // The SDK's "submitted, but the answer was unexpected": the order or cancel may have gone through.
  UNEXPECTED_ADD_ORDER_RESPONSE: "ORDER_OUTCOME_UNKNOWN",
  UNEXPECTED_CANCELLATION_RESPONSE: "CANCEL_OUTCOME_UNKNOWN",
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
