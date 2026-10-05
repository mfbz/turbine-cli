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
      const lines = [`${theme.error("✗ error:")} ${report.message}`];
      if (report.hint) lines.push(theme.dim(`  ${report.hint}`));
      if (stack) lines.push(theme.dim(stack));
      err(`${lines.join("\n")}\n`);
      return exitCode;
    },
  };
}

export { createOutput };
export type { Output, Writer };
