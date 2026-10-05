type ExitCode = 1 | 2;
type ErrorReport = { code: string; message: string; hint?: string };
type FullReport = ErrorReport & { exitCode: ExitCode; stack?: string };

// What the Turbine API's error codes mean for someone at a terminal, and what to do next. Codes not
// listed keep the API's own message.
const TURBINE_HINTS: Readonly<Record<string, ErrorReport>> = {
  SERVICE_UNAVAILABLE: {
    code: "SERVICE_UNAVAILABLE",
    message: "Turbine is unavailable right now.",
    hint: "Try again in a minute. The playground and mainnet are separate: --network picks one.",
  },
  UNAUTHORIZED: {
    code: "UNAUTHORIZED",
    message: "Turbine didn't accept the wallet's signature.",
    hint: "Check that TURBINE_PRIVATE_KEY or TURBINE_KEY_FILE holds the wallet you mean, then run turbine config.",
  },
  USER_ORDER_LIMIT_REACHED: {
    code: "USER_ORDER_LIMIT_REACHED",
    message: "This wallet already has the most active orders Turbine allows.",
    hint: "Cancel some with turbine order cancel <hash>, or wait for them to fill or expire.",
  },
};

// Anything shaped like a private key. Usage errors quote what was typed, and someone may have pasted
// a key into the wrong place; nothing a usage error needs to show is 64 hex digits long.
const KEY_SHAPED = /(?:0x)?[0-9a-fA-F]{64}/g;

function maskKeys(text: string): string {
  return text.replace(KEY_SHAPED, "[redacted]");
}

class CliError extends Error {
  readonly code: string;
  readonly hint: string | undefined;
  readonly exitCode: ExitCode;

  constructor(
    code: string,
    message: string,
    options: { hint?: string; exitCode?: ExitCode; cause?: unknown } = {}
  ) {
    super(message, { cause: options.cause });
    this.name = "CliError";
    this.code = code;
    this.hint = options.hint;
    this.exitCode = options.exitCode ?? 1;
  }
}

function isCoded(value: unknown): value is { code: string; message: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { code?: unknown }).code === "string" &&
    typeof (value as { message?: unknown }).message === "string"
  );
}

function withHint(report: ErrorReport, hint: string | undefined): ErrorReport {
  return hint === undefined ? report : { ...report, hint };
}

function toErrorReport(error: unknown, debug: boolean): FullReport {
  if (error instanceof CliError) {
    return {
      ...withHint({ code: error.code, message: error.message }, error.hint),
      exitCode: error.exitCode,
    };
  }
  // The SDK's TurbineError has this shape; matching the shape keeps this module free of the SDK.
  if (isCoded(error)) {
    const known = TURBINE_HINTS[error.code];
    return {
      ...(known ?? { code: error.code, message: error.message }),
      exitCode: 1,
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  const report: FullReport = {
    code: "UNEXPECTED",
    message,
    hint: "Run again with --debug for details.",
    exitCode: 1,
  };
  if (debug && error instanceof Error && error.stack)
    report.stack = error.stack;
  return report;
}

export { CliError, maskKeys, toErrorReport };
export type { ErrorReport, ExitCode };
