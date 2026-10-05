import { redact, redactValue } from "../wallet/redact.ts";
import { CliError, toErrorReport } from "./errors.ts";
import type { ExitCode } from "./errors.ts";
import type { Theme } from "./theme.ts";

type Writer = (text: string) => void;
type Output = {
  json: boolean;
  theme: Theme;
  /** The command's result: one --json document, or the human rendering, on stdout. */
  result<T>(data: T, human: (theme: Theme) => string): void;
  /** Progress or context for a person, on stderr; silent with --json so stdout stays one document. */
  note(text: string): void;
  /** Reports a failure the same way everywhere and returns the exit code. */
  fail(error: unknown): ExitCode;
};
type OutputOptions = {
  json: boolean;
  debug: boolean;
  theme: Theme;
  stdout: Writer;
  stderr: Writer;
  // A function: the key is loaded by a command after the output exists, and must be redacted from then on.
  secrets: () => readonly string[];
};

// C0 and C1 control characters (ESC, BEL, CR, CSI…), optionally keeping newlines and tabs. Text from
// the Turbine API is the server's to choose, so it is cleaned before it reaches a terminal: an escape
// sequence could otherwise clear the screen, retitle the window or forge a line of output.
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;
const CONTROL_AND_LAYOUT = /[\u0000-\u001f\u007f-\u009f]/g;

/** Untrusted text made safe to print in a terminal. JSON output needs none of this: JSON escapes it. */
function plain(text: string, options: { newlines?: boolean } = {}): string {
  return text.replace(options.newlines ? CONTROL : CONTROL_AND_LAYOUT, "");
}

// Turbine's own error code, already held to SCREAMING_SNAKE by toErrorReport, after our words.
function withUpstream(message: string, code: string | undefined): string {
  return code === undefined ? message : message.replace(/\.$/, ` (${code}).`);
}

// bigint is how the SDK and viem carry token amounts; JSON has no such type, so they become strings.
// redactValue has already turned them into strings by the time a document is written.
function toJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    typeof v === "bigint" ? v.toString() : v
  );
}

function createOutput(options: OutputOptions): Output {
  const { json, debug, theme } = options;
  const secrets = () => options.secrets();
  const out = (text: string) => options.stdout(redact(text, secrets()));
  // Documents are redacted value by value before they're serialised; scrubbing the JSON text itself
  // could cut through its quotes and braces.
  const document = (value: unknown) =>
    options.stdout(`${toJson(redactValue(value, secrets()))}\n`);
  const err = (text: string) => options.stderr(redact(text, secrets()));
  return {
    json,
    theme,
    result(data, human) {
      if (json) document({ ok: true, data });
      else out(`${human(theme)}\n`);
    },
    note(text) {
      if (!json) err(`${text}\n`);
    },
    fail(error) {
      let full = toErrorReport(error);
      // Catalogue text can only hold safe-shaped parameters; if a secret still got in, say less.
      const shown = `${full.message}\n${full.hint}`;
      if (redact(shown, secrets()) !== shown) {
        full = {
          ...toErrorReport(new CliError("INTERNAL")),
          debug: full.debug,
        };
      }
      const { exitCode, debug: details, ...report } = full;
      if (json) document({ ok: false, error: report });
      else {
        err(
          `${theme.error("✗ error:")} ${plain(withUpstream(report.message, report.upstreamCode))}\n${theme.dim(`  ${plain(report.hint)}`)}\n`
        );
      }
      // Details for a bug report: class name and stack frames only, on stderr, never in the document.
      if (debug && details) {
        const lines = [
          `debug: ${details.className}`,
          ...details.frames.map((f) => `  ${f}`),
        ];
        err(`${theme.dim(plain(lines.join("\n"), { newlines: true }))}\n`);
      }
      return exitCode;
    },
  };
}

export { createOutput, plain };
export type { Output, Writer };
