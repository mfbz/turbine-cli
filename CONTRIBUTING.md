# Contributing to turbine-cli

Thanks for helping. turbine-cli is built by people and by coding agents, with the same rules for both. It signs orders with real wallets, so the safety rules in [TURBINE-CLI.md](TURBINE-CLI.md#safety-design) come first.

## Setup

- Node 24 (`.nvmrc`), then `npm ci`. Installing also switches on the Git hooks (`core.hooksPath` → `.githooks/`).
- For the playground, create a throwaway wallet with `turbine wallet new` (no real funds involved). `.env.example` lists every setting; turbine-cli reads them from your shell only.
- Windows: enable symlinks before cloning (`git config --global core.symlinks true`, Developer Mode on) so `.claude/skills` works.

```bash
npm run check             # format:check, lint, typecheck, test: must be green before a PR
npm run cli -- --help     # run the CLI from source
npm run build             # bundle to dist/main.mjs
npm run smoke:playground  # reads and dry runs against the live playground; signs nothing
npm run demo:record       # re-record assets/demo.gif against the mock (needs asciinema and agg)
```

## How work happens

1. **`TURBINE-CLI.md` is the spec.** A change to what the CLI does (a command, a flag, an output, a safety rule) updates its section there in the same pull request, with acceptance checks tied to tests. Fixes, refactors, docs, CI and tooling keep it true.
2. **One topic per branch**, from an up-to-date `main`: `feat/…`, `fix/…`, `perf/…`, `docs/…`, `chore/…`, `ci/…`, `test/…`, `refactor/…`. Conventional commits.
3. **Tests first.** Write the test, watch it fail, make it pass.
4. **Green and reviewed.** `npm run check` passes locally and in CI, and the branch gets an independent, adversarial review before its pull request ([AGENTS.md](AGENTS.md), "Workflow"): findings are reproduced, then fixed or rejected with a reason in the pull request's Evidence.
5. **Pull request to `main`**, titled as a conventional commit (`fix(order): …`). The maintainer reviews it and squash-merges it once the `ci` check passes, so each pull request becomes one commit on `main`; the branch is then deleted. A coding agent may squash-merge only when the maintainer has said so for that work, after `ci` is green and the independent review is recorded in the pull request. If `main` moved on meanwhile, merge `main` into the branch (no force-push).

Coding agents (Claude Code, Codex and others) read [AGENTS.md](AGENTS.md) and the skills in `.agents/skills/`. Issues created with the "Task" form are ready for an agent to pick up.

## Definition of done

- The behaviour is in `TURBINE-CLI.md`, and every acceptance check there is proven by a test or a named manual check.
- `npm run check` is green; CI's `ci` check is green (including the packed CLI installed and run on Linux, macOS and Windows).
- Anything that signs or sends has a `--dry-run` path and a test that it signs nothing in that mode.
- No key, seed phrase or token appears in any output, log or error (tests assert it).
- A change to how turbine-cli talks to Turbine passes `npm run smoke:playground` (with a playground wallet, so the dry runs run too).
- The README and any doc the change makes wrong are updated.

## Guards

Every change passes the same guards, whoever writes it. They run twice:

- **On every commit.** `.githooks/pre-commit` checks what is staged and `.githooks/commit-msg` checks the message, so nothing bad ever becomes a commit. Plain Node 24 runs them; nothing needs installing first.
- **In `npm test`.** `tools/checks/guards-repo.test.ts` checks every file Git would commit, so a skipped hook is still caught in CI.
- **On every pull request.** CI's `pull-request` job checks the title (a conventional commit) and the description with the commit-message guards, because together they become the squash commit on `main`.

The guards block:

- private keys: PEM blocks, and Ethereum keys where code puts them (a key-like name, `privateKeyToAccount(…)`, `--private-key …`, Hardhat `accounts`); a bare 64-hex string such as a transaction hash is fine
- seed phrases, and the usual API and token formats
- the home folder of the computer running the check
- an AI tool or bot credited as a co-author (people crediting each other is fine)
- files over 1 MB

Claude Code is also denied `--no-verify`, changing `core.hooksPath`, editing `.githooks/` and pushing to `main` (`.claude/settings.json`). Other agents get the same rules from AGENTS.md.

If a guard trips:

- **A key or seed phrase:** remove it. If it was ever pushed anywhere, treat the wallet as burnt: move its funds to a new wallet. Deleting it from Git isn't enough.
- **A token:** remove it and revoke it with its provider.
- **A path or an attribution line:** fix the file, or whatever generated it.

## Releasing

Nothing is published yet. When it is, releases are by hand only:

- `.github/workflows/release.yml` runs from **Actions → Release → Run workflow** on `main`, with a version (`x.y.z`). It stamps the version, runs `npm run check`, packs, publishes to npm with provenance through trusted publishing (no npm token anywhere), and creates the GitHub release `vx.y.z` with notes from the merged pull request titles.
- Versions live in tags only: `package.json` says `0.0.0`, so the code never states a version that could drift.
- Pull request titles become the release notes: write them for the people who use turbine-cli.

## Repository settings (maintainer)

Applied now:

- Pull requests: squash merging only, with the pull request title and description as the commit; "Always suggest updating pull request branches" and "Automatically delete head branches" on.
- Wiki, Projects and Discussions off. Dependabot alerts and security updates on.

When the repository is public:

- A ruleset on `main`: pull requests only, squash only, the `ci` check required on an up-to-date branch, no force-push, no deletion. While there is one maintainer, they merge with the admin bypass, only once `ci` is green.
- Secret scanning with push protection, and private vulnerability reporting ([SECURITY.md](SECURITY.md)).
- Before the first release, once:
  1. Claim the name: from a clean checkout of `main`, `npm publish --access public` by hand with your own npm account and two-factor authentication. This publishes the empty `0.0.0`; npm only offers trusted publishing for a package that exists.
  2. On npmjs.com, in the package's settings: add a trusted publisher for this repository's `release.yml` with environment `npm`, then set publishing access to "Require two-factor authentication and disallow tokens".
  3. On GitHub: create the `npm` environment, allowed to deploy from `main` only.

## Licence of contributions

Contributions are accepted under the [MIT licence](LICENSE).
