# AGENTS.md: turbine-cli

turbine-cli is an unofficial command line for Turbine, the private orderbook on Ethereum: quote, place, ladder and watch spread orders from a terminal or an agent. It signs orders with a user's wallet key, so safety rules come before features. This file is for every coding agent; keep it short and move detail into skills.

Read in this order, only as far as the task needs:

1. `TURBINE-CLI.md`: what the CLI is and how every command behaves (the source of truth). When code and that file disagree, flag it; never drift silently.
2. The skill for the area you touch (`.agents/skills/`, also visible to Claude Code as `.claude/skills/`).
3. `DESIGN.md` for anything a person sees in the terminal.

## Map

| Path                | What                                                                                   |
| ------------------- | -------------------------------------------------------------------------------------- |
| `src/`              | the CLI: `main.ts` (bin entry), `cli.ts` (`run(argv, output)`), one folder per feature |
| `tools/checks/`     | guards (secrets, keys, personal paths, AI attribution, size) and repo-invariant tests  |
| `.githooks/`        | `pre-commit` and `commit-msg`, running the guards with plain Node                      |
| `.agents/skills/`   | skills for agents working on this repo                                                 |
| `skills/`           | the user-facing skill that teaches an agent to drive the CLI (ships in the package)    |
| `scripts/`          | the logo generator, the local mock of Turbine, the playground smoke test, the demo GIF |
| `assets/`           | Turbine's logo (with its notice) and the README's demo GIF                             |
| `.github/`          | CI, the manual release, PR and issue templates                                         |
| `docs/superpowers/` | gitignored scratch for designs and plans; never committed                              |

## Commands

```bash
npm ci                    # install (Node 24, .nvmrc); also switches on the Git hooks
npm run check             # green checkpoint: format:check, lint, typecheck, test
npm run format            # Prettier (a Claude hook also formats each edited file)
npm test                  # Vitest: src/, scripts/ and tools/checks/, including the repo-wide guards
npm run build             # bundle to dist/main.mjs (tsdown)
npm run cli -- --help     # build, then run the CLI
npm run logo:build        # after changing assets/brand/turbine-logo.svg or scripts/build-logo.ts
npm run mock              # a local mock of Turbine's playground (README, "Try it without Turbine")
npm run smoke:playground  # reads and dry runs against the live playground; signs nothing
npm run demo:record       # re-record assets/demo.gif after changing what the demo shows
```

Turbine's SDK is pinned to a commit and bundled; it ships raw TypeScript, so `tsc` and lint read `types/turbine-sdk.d.ts` instead (`tsconfig.check.json`), and `src/turbine/sdk-orders.test.ts` checks the real SDK's behaviour. Load it lazily (`await import`), only where a command signs.

Generated (never edit by hand): `src/ui/logo-frames.ts` (from `assets/brand/turbine-logo.svg`; Turbine's logo belongs to PropellerHeads, see `assets/brand/NOTICE.md`).

## Decisions that bind

- **Playground is the default.** Mainnet only with an explicit `--network mainnet` and a confirmation that shows amount, tokens, spread, limit and lifetime.
- **`--dry-run` everywhere**: every command that signs or sends can show exactly what it would sign and send instead.
- **Never sign silently.** Keys live only in encrypted keystores (`turbine wallet new|import`, or Foundry's), unlocked by a hidden prompt, `--password-file` or `TURBINE_WALLET_PASSWORD` from the shell. turbine-cli never takes a raw key from an argument, a variable or a file, and refuses a key-shaped argument. Commands get a signer, never the key.
- **Errors come from the catalogue only** (`src/output/errors.ts`): never print a library's or the API's error text, or a typed value. Add a catalogue code instead.
- Output: `--json` prints exactly one JSON document on stdout, errors included (`{ "ok": true, "data": … }` or `{ "ok": false, "error": { "code", "message", "hint" } }`), with a non-zero exit code on failure. Without `--json`, errors go to stderr. Human output respects `NO_COLOR` and non-TTY.
- The user-facing agent skill always quotes first, dry-runs, and asks a human before `place`, `ladder` or `cancel`.
- turbine-cli is a standalone product. Write it that way everywhere (code, docs, commits, PRs, issues): no personal context, no backstory, and always "unofficial, not affiliated with Turbine or PropellerHeads".
- KISS. No secrets in the repo, ever, not even well-known development keys: tests generate keys at run time.

## Code conventions

Details and examples: skill `turbine-conventions`.

- TypeScript strict (`noUncheckedIndexedAccess`, `erasableSyntaxOnly`), ES modules, kebab-case files, named exports, no barrel files, relative imports with the `.ts` extension, `import type` for types.
- File order: imports → types → constants → private helpers → exported functions; one `export { … }` at the end. Comments explain why, never what.
- zod at every boundary (env, files, network, CLI input). Tests co-located as `*.test.ts` (Vitest), `it` strings read as behaviour.

## Workflow

- There is no `specs/` folder: `TURBINE-CLI.md` is the one living spec. A change to what the CLI does edits its section there (behaviour, flags, the `--json` shape, acceptance checks tied to tests) in the same PR. Fixes, refactors, docs, CI and tooling just keep it true.
- Designs and plans are scratch in `docs/superpowers/` (gitignored); the PR description is the record.
- Stay inside the task; list anything else under "Follow-ups" in the PR.
- Test first: watch the test fail, then make it pass.
- Run `npm run check` before saying you are done, and quote its result.
- Before opening a PR, get an independent, adversarial review of the branch from a fresh context that didn't write it (Claude Code: `/code-review high`, plus `/security-review` for keys, signing, the guards, settings or workflows; Codex: `codex review`). Findings are claims to verify: reproduce each one (a failing test or command) before fixing it, or reject it with a reason. Record what was found, fixed and rejected in the PR's Evidence.
- Ask the maintainer when `TURBINE-CLI.md` is ambiguous; don't guess on product decisions. Mark anything unverified as such.

## Git

- Trunk-based: `main` is the only long-lived branch and is always green. Every change starts on a short branch from an up-to-date `main`: `feat/…`, `fix/…`, `perf/…`, `docs/…`, `chore/…`, `ci/…`, `test/…`, `refactor/…`. Conventional commits (`feat(order): …`, `fix(watch): …`).
- A change reaches `main` only through a pull request whose checks pass. Push the branch, open the PR against `main` (`gh pr create`) with the template filled in; its title is a conventional commit, because it becomes the one commit on `main`. The maintainer reviews and squash-merges it. An agent squash-merges a PR only when the maintainer has said so for that work, only after `ci` is green and the independent review is recorded in the PR, and never with failing or pending checks.
- Behind `main`? Merge `main` into your branch (no rebase of pushed work, no force-push). Never push to `main`, never commit `.env` files or keys.
- Never bump versions (they stay `0.0.0` in the code), create tags or publish; releases are the maintainer's, by hand (CONTRIBUTING "Releasing").
- Never credit an AI tool as an author: no `Co-Authored-By` trailers for coding agents, no "Generated with …" lines, in commits, PRs, issues or docs.
- Guards check every commit (Git hooks, on from `npm install`), every committable file (`npm test`) and every PR's title and description (CI): no keys, seed phrases or tokens, no home-folder paths, no AI attribution, nothing over 1 MB. Fix the cause; never weaken a guard, never `--no-verify`, never change `core.hooksPath`.
