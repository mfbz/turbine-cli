#!/usr/bin/env node
import { run } from "./cli.ts";

// A reader that stops early (`turbine orders --json | head`) is a normal pipeline, not a crash.
for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") process.exit(process.exitCode ?? 0);
    throw error;
  });
}

process.exitCode = run(process.argv.slice(2), {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
});
