#!/usr/bin/env node
import { homedir } from "node:os";

import { isCancel, password } from "@clack/prompts";

import { run } from "./cli.ts";

// A reader that stops early (`turbine orders --json | head`) is a normal pipeline, not a crash.
for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") process.exit(process.exitCode ?? 0);
    throw error;
  });
}

process.exitCode = await run(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  env: process.env,
  cwd: process.cwd(),
  home: homedir(),
  platform: process.platform,
  stdoutInfo: process.stdout,
  interactive: process.stdin.isTTY && process.stdout.isTTY,
  prompter: {
    // Hidden input, on the terminal only; a cancelled prompt (Ctrl-C, Esc) is undefined.
    async secret(message) {
      const answer = await password({ message, mask: "•" });
      return isCancel(answer) ? undefined : answer;
    },
  },
});
