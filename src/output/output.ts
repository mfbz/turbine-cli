import { redact } from "../wallet/redact.ts";
import { toErrorReport } from "./errors.ts";
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

// bigint is how the SDK and viem carry token amounts; JSON has no such type, so they become strings.
function toJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    typeof v === "bigint" ? v.toString() : v
  );
}

function createOutput(options: OutputOptions): Output {
  const { json, debug, theme } = options;
  const clean = (text: string) => redact(text, options.secrets());
  const out = (text: string) => options.stdout(clean(text));
  const err = (text: string) => options.stderr(clean(text));
  return {
    json,
    theme,
    result(data, human) {
      out(json ? `${toJson({ ok: true, data })}\n` : `${human(theme)}\n`);
    },
    note(text) {
      if (!json) err(`${text}\n`);
    },
    fail(error) {
      const { exitCode, stack, ...report } = toErrorReport(error, debug);
      if (json) {
        out(`${toJson({ ok: false, error: report })}\n`);
        return exitCode;
      }
      const lines = [`${theme.error("✗ error:")} ${plain(report.message)}`];
      if (report.hint) lines.push(theme.dim(`  ${plain(report.hint)}`));
      if (stack) lines.push(theme.dim(plain(stack, { newlines: true })));
      err(`${lines.join("\n")}\n`);
      return exitCode;
    },
  };
}

export { createOutput, plain };
export type { Output, Writer };
