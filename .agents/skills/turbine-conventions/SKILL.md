---
name: turbine-conventions
description: Use when writing or reviewing code in the turbine-cli repo. Covers layout, naming, file order, exports, validation at boundaries, handling keys and secrets, output rules (--json, NO_COLOR, stderr), tests and the green checkpoint.
---

# turbine-cli code conventions

## Layout

- One package at the root. `src/main.ts` is the bin entry and only wires `process` to `run()` in `src/cli.ts`; everything else is testable without spawning a process.
- One folder per feature under `src/` (e.g. `src/quote/`, `src/order/`), each with its code and co-located tests. Generic helpers only in `src/lib/`.
- Repo rules live in `tools/checks/` as tests, so they fail loudly instead of being forgotten.

## TypeScript

- Strict, `noUncheckedIndexedAccess`: handle `undefined` from indexing instead of using `!`, except in tests.
- `erasableSyntaxOnly`: no enums, namespaces or parameter properties, so Node runs the source directly (`npm run cli`).
- kebab-case file names; named exports; no `index.ts` barrels; import from the source file with its `.ts` extension; `import type` for types.
- File order: imports → types → constants → private helpers → exported functions. End modules with one `export { … }` line (and `export type { … }`).
- Comments explain why (a constraint, a trade-off, a past bug), never what.
- Paths from `import.meta.url`, never `process.cwd()`, except where the user's working folder is the point (their `.env`).

## Boundaries

- Validate with zod wherever data enters: environment and `.env`, files, API responses, CLI arguments. Inside, trust the types.
- Errors a person will read say what happened and what to do next, in one or two lines.

## Keys and secrets

- Keys enter only through the one key loader. Nothing else reads `TURBINE_PRIVATE_KEY` or `TURBINE_KEY_FILE`.
- Pass every string that leaves the process (stdout, stderr, logs, `--json`, error messages) through `redact()`.
- Tests generate keys at run time (viem `generatePrivateKey()`). Never a literal key in the repo, not even a well-known development key: the guards block it.

## Output

- `--json`: exactly one JSON document on stdout, errors included; nothing else on stdout.
- Human output: colour and motion only when stdout is a TTY and `NO_COLOR` is unset; plain otherwise.
- Errors to stderr, with a non-zero exit code (2 for usage errors).

## Tests

- Vitest, `foo.ts` next to `foo.test.ts`; `describe` per unit, `it` as a behaviour sentence.
- Write the test first and watch it fail for the right reason.
- Cover what users will hit, not only the happy path: piped output, bad input, missing or unreadable key, mainnet without confirmation, network errors.

## Green checkpoint

`npm run check` = format:check + lint (zero warnings) + typecheck + test. Run it before saying you are done.

Example module shape:

```ts
import { readFileSync } from "node:fs";

import type { Network } from "./network.ts";

type Settings = { network: Network };

const DEFAULT_NETWORK: Network = "playground";

function parse(text: string): Partial<Settings> {
  return JSON.parse(text) as Partial<Settings>;
}

function loadSettings(path: string): Settings {
  return { network: DEFAULT_NETWORK, ...parse(readFileSync(path, "utf8")) };
}

export { loadSettings };
export type { Settings };
```
