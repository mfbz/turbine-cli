#!/usr/bin/env node
import { run } from "./cli.ts";
import { realKeyFs } from "./wallet/key.ts";

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
  stdoutInfo: process.stdout,
  keyFs: realKeyFs,
});
