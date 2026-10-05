#!/usr/bin/env node
import { homedir } from "node:os";
import tls from "node:tls";

import { confirm, isCancel, password, select, text } from "@clack/prompts";

import { run } from "./cli.ts";
import { CliError, toErrorReport } from "./output/errors.ts";
import { preferClassicKeyShares } from "./net/tls.ts";
import { createCursor } from "./ui/cursor.ts";
import type { Choice } from "./wallet/signer.ts";

// Before anything connects: every request (Turbine, the SDK, the RPC) uses these defaults.
preferClassicKeyShares(tls);

// A reader that stops early (`turbine orders --json | head`) is a normal pipeline, not a crash.
for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") process.exit(process.exitCode ?? 0);
    throw error;
  });
}

// Ctrl-C outside a prompt (during the header's animation, say): give the cursor back, then stop
// with the conventional code for an interrupt. Prompts handle Ctrl-C themselves.
const cursor = createCursor((text) => process.stdout.write(text));
process.once("SIGINT", () => {
  cursor.restore();
  // --json promises one document, an interrupt included.
  if (process.argv.slice(2).includes("--json")) {
    const { code, message, hint, retryable } = toErrorReport(
      new CliError("CANCELLED")
    );
    const error = { code, message, hint, retryable };
    process.stdout.write(`${JSON.stringify({ ok: false, error })}\n`);
  }
  process.exit(130);
});

process.exitCode = await run(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  env: process.env,
  home: homedir(),
  platform: process.platform,
  stdoutInfo: process.stdout,
  // All three: the result goes to stdout, prompts draw on stderr and read stdin.
  interactive:
    process.stdin.isTTY && process.stdout.isTTY && process.stderr.isTTY,
  cursor,
  // Key by key while a live view runs; the terminal is put back however the view ends.
  keys(handler) {
    const onData = (chunk: Buffer) => {
      for (const key of chunk.toString("utf8")) handler(key);
    };
    process.stdin.setRawMode(true);
    process.stdin.on("data", onData);
    process.stdin.resume();
    return () => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
    };
  },
  // Prompts draw on stderr: stdout is only for the result (one --json document). A cancelled prompt
  // (Ctrl-C, Esc) is undefined.
  prompter: {
    async secret(message) {
      const answer = await password({
        message,
        mask: "•",
        output: process.stderr,
      });
      return isCancel(answer) ? undefined : answer;
    },
    async choose<T extends string>(
      message: string,
      choices: readonly Choice<T>[]
    ): Promise<T | undefined> {
      // clack's option type is conditional on a concrete value type, so it is asked with string and
      // narrowed back: the answer is always one of the values offered.
      const answer = await select<string>({
        message,
        options: choices.map((c) =>
          c.hint === undefined
            ? { value: c.value, label: c.label }
            : { value: c.value, label: c.label, hint: c.hint }
        ),
        output: process.stderr,
      });
      return isCancel(answer)
        ? undefined
        : choices.find((c) => c.value === answer)?.value;
    },
    async confirm(message) {
      const answer = await confirm({
        message,
        initialValue: false,
        output: process.stderr,
      });
      return isCancel(answer) ? undefined : answer;
    },
    async text(message, initial) {
      const answer = await text({
        message,
        initialValue: initial,
        output: process.stderr,
      });
      return isCancel(answer) ? undefined : answer;
    },
  },
});
