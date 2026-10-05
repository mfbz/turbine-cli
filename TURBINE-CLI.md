# turbine-cli

An unofficial command line for Turbine, the private orderbook on Ethereum: quote, place, ladder and watch spread orders from your terminal or your agent.

This file says what turbine-cli **is** and is the source of truth for its behaviour. A change to what the CLI does updates this file in the same pull request. When the code and this file disagree, that's a bug in one of them.

## Status

In development. Nothing is published to npm yet; run it from source.

turbine-cli is an unofficial community tool. It is not affiliated with, endorsed by or supported by Turbine or PropellerHeads. It uses Turbine's public API and official TypeScript SDK.

## What Turbine is

[Turbine](https://docs.turbine.exchange) is a private orderbook on Ethereum for people who move size and care about cost more than speed.

- **Spread orders.** An order tracks the market mid price with a spread, not a fixed price, and can live for hours or days. A negative spread means "only trade better than mid", which is how market makers quote.
- **The Speedbump.** Every action is delayed by about 12 seconds, so nobody can snipe an order.
- **Private.** Orders are kept private in a trusted execution environment (TEE).
- **Batch settlement.** Trades settle in batches at one uniform price, matched in this order: peer to peer first (zero spread, zero fees), then Turbine's liquidity pools, then external DeFi liquidity.

## Why a CLI

Today there are two ways to trade on Turbine: the web app, one order at a time, or writing TypeScript against the SDK. Nothing sits in between for people who want to script, repeat or delegate their trading without writing an application.

Turbine's API serves browsers only from its official frontend, so third-party web apps are blocked, while local tools work. A command line fits that boundary.

## Who it is for

- **Market makers**, who quote ladders of orders at several price levels. Turbine's docs describe doing this by hand; `turbine ladder` does it in one command.
- **Treasuries and funds moving size**, who place one long-lived spread order and then watch it fill.
- **Agents**, which quote, place and monitor orders through `--json` output, with a human approving anything that signs.

## Safety design

These rules bind every command and every change:

- **Playground is the default.** Turbine's playground uses simulated settlements and simulated traffic, with no real funds. Mainnet is used only with an explicit `--network mainnet`, and each order on mainnet first shows a confirmation with the amount, tokens, spread, limit and lifetime.
- **`--dry-run` everywhere.** Every command that would sign or send something can instead show exactly what it would sign and send, and stop.
- **Never sign silently.** Nothing is signed without the command saying what it is signing.
- **Keys stay encrypted.** A wallet is an encrypted keystore (`turbine wallet new` or `turbine wallet import`; Foundry keystores work too), unlocked by a hidden password prompt, a password file, or `TURBINE_WALLET_PASSWORD` from your shell. turbine-cli never reads a raw private key from an argument, an environment variable or a plain file, and refuses a key typed as an argument. The key and password never appear in any output.
- **Errors say only what we wrote.** Every error message comes from turbine-cli's own catalogue, keyed by a stable code; a library's or the Turbine API's text, or a value you typed, is never repeated.
- **Use a dedicated wallet** with a small balance, never your main one.

## Interface

Two ways in:

- **Direct commands** for scripts and agents: `turbine quote 10 WETH USDC`.
- **An interactive session**: `turbine` with no arguments, in a terminal, opens a guided session with the same commands.

Global flags:

| Flag                              | Meaning                                                                  |
| --------------------------------- | ------------------------------------------------------------------------ |
| `--network playground\|mainnet`   | which Turbine network to use; `playground` unless stated on the command  |
| `--json`                          | machine output for scripts and agents                                    |
| `--dry-run`                       | show exactly what would be signed and sent, then stop                    |
| `-y`, `--yes`                     | skip confirmations; mainnet needs it when there is no terminal to ask in |
| `--no-motion`                     | no animation (also `TURBINE_NO_MOTION=1`)                                |
| `--debug`                         | show details, including stack traces, when something fails               |
| `-v`, `--version`, `-h`, `--help` | the version, and help for any command                                    |

Output rules:

- With `--json`, a command prints exactly one JSON document on stdout, errors included: `{ "ok": true, "data": … }` or `{ "ok": false, "error": { "code", "message", "hint"? } }`. Nothing else goes to stdout, and a failure still exits non-zero. Token amounts are strings, so no precision is lost.
- Human output uses colour and motion only in an interactive terminal. It respects `NO_COLOR` and stays plain when piped. How it looks: [DESIGN.md](DESIGN.md).
- Without `--json`, errors go to stderr, with a non-zero exit code.
- Exit codes: `0` done, `1` failed, `2` usage error (an unknown command or flag, a bad value), `130` interrupted (Ctrl-C, including at a prompt).
- Error messages and hints come only from turbine-cli's catalogue (stable `code`s for agents to branch on, plus `retryable`). An unknown API error is `API_REJECTED`, with the API's code in `upstreamCode` only if it is a plain `SCREAMING_SNAKE` word. `--debug` adds the error's class and stack frames on stderr, never in the `--json` document and never values.
- A private key typed as an argument is refused (`KEY_IN_ARGV`, exit 2) without being echoed. The key and the wallet password never appear in any output. Text from the Turbine API is stripped of control characters before it reaches a terminal.

## Commands

Flags, the `--json` shape and acceptance checks are added to each command here with the change that builds it.

### `turbine` (the interactive session)

`turbine` with no arguments, in a terminal, opens the session: Turbine's logo with the mark turning (DESIGN.md, "The header"), then a menu of the same actions the direct commands run. Today: get a quote, supported tokens, show my setup, my wallets, create or import a wallet, switch network. Each command that lands adds its own entry.

- Switching to mainnet asks for confirmation first; the header and every summary name the network.
- An action that fails shows its error and returns to the menu; Ctrl-C or Esc at the menu quits.
- Without a terminal, or with `--json`, `turbine` prints help instead (as a `{ "help" }` document with `--json`).

Status: done.

Acceptance:

- [x] In a terminal the header and the menu open; quitting exits 0; a cancelled menu quits (`src/cli.test.ts` "the interactive session").
- [x] An action's error is shown and the session carries on (`src/cli.test.ts` "shows an error from one action and carries on").
- [x] Mainnet needs a confirmation, and the setup then says mainnet (`src/cli.test.ts` "asks before switching to mainnet").
- [x] The header fits 80, 56 and narrower terminals, marks mainnet, and gives the cursor back even if drawing fails (`src/ui/header.test.ts`).
- [x] The logo frames are generated from the SVG and committed exactly as generated (`scripts/build-logo.test.ts`).

### `turbine config`

Shows what turbine-cli will use: the network, the Turbine API, the RPC endpoint, and the wallet (its address and where the key came from, never the key). The quickest way to check a setup before anything is signed.

`--json` data:

```json
{
  "network": "playground",
  "apiUrl": "https://playground-api.turbine.exchange/api",
  "rpcUrl": null,
  "wallet": { "name": "default", "address": "0x…", "source": "turbine" }
}
```

`rpcUrl` is the endpoint's origin only (provider URLs carry an API key in the path). `wallet` is `null` when there is no wallet yet; `address` is the one its keystore declares (the wallet isn't unlocked to show it); `source` is `turbine` or `foundry`. A wallet asked for by name (`--account`, `TURBINE_ACCOUNT`) must exist.

Status: done.

Acceptance:

- [x] The playground is the default, and the output says the funds are simulated (`src/cli.test.ts` "shows the playground by default", `src/commands/config.test.ts`).
- [x] `--json` returns the shape above (`src/cli.test.ts` "returns the setup as JSON").
- [x] A key typed as an argument is refused without being echoed (`src/cli.test.ts` "a private key on the command line").
- [x] `TURBINE_NETWORK=mainnet` without `--network mainnet` is refused (`src/cli.test.ts`, `src/config/network.test.ts`).
- [x] No colour codes when piped (`src/cli.test.ts` "writes no colour codes when piped").

### `turbine wallet new|import|list`

Wallets are encrypted keystores in the standard Web3 Secret Storage format (scrypt), so they work with geth and Foundry too. turbine-cli keeps its own in `~/.config/turbine-cli/wallets/` (`%APPDATA%\turbine-cli\wallets` on Windows), each file readable only by you, and also uses Foundry's (`~/.foundry/keystores`).

- `turbine wallet new [name]`: a fresh wallet (the easiest start on the playground). Asks for a password twice in a terminal; for scripts, `--password-file` or `TURBINE_WALLET_PASSWORD`. Passwords have at least 8 characters.
- `turbine wallet import [name]`: brings a wallet you have. The private key is typed into a hidden prompt, in a terminal only; it is never taken from an argument, a variable or piped input.
- `turbine wallet list`: names, addresses and where each lives.
- `[name]` defaults to `default`; names use letters, digits, `.`, `-` and `_` (up to 64, as Foundry's do). A wallet is never overwritten, and a wallet file or wallets folder that is a link is refused.
- Other commands pick the wallet with `--account <name>` or `TURBINE_ACCOUNT`, and unlock it with the hidden prompt, `--password-file <file>` (chmod 600) or `TURBINE_WALLET_PASSWORD` from the shell. Without a terminal and without a password they fail at once (`PASSWORD_REQUIRED`) rather than wait.

`--json` data: `new` and `import` return `{ "name", "address", "path" }`; `list` returns `[{ "name", "address", "source", "path" }]`.

Status: done.

Acceptance:

- [x] Keystores round-trip, a wrong password or a tampered file is refused, and the format reads the Web3 Secret Storage test vector (`src/wallet/keystore.test.ts`).
- [x] Files are created 600 in a 700 folder, never overwritten, and names can't become paths (`src/wallet/store.test.ts`).
- [x] Without a terminal or a password, commands fail instead of waiting; a `.env` in the current folder is ignored (`src/wallet/signer.test.ts`, `src/cli.test.ts`).
- [x] An imported key and the password never appear in any output (`src/cli.test.ts` "imports a key only through a hidden prompt").

### `turbine tokens`

The tokens Turbine supports on the selected network (from Turbine's `/api/config`).

`--json` data: `[{ "address", "symbol", "decimals", "tokenClass" }]`.

Status: done.

### `turbine quote <amount> <sell> <buy> [--spread <bps>]`

The mid price for a pair, what selling `<amount>` would bring at mid, Turbine's fee, and what swapping elsewhere costs now. With `--spread`, also the least you'd receive at the edge of that spread (positive: up to that much worse than mid; negative: only that much better than mid or more). Tokens are symbols or addresses; amounts are in whole tokens (`1.5`). Nothing is signed: quoting uses Turbine's public `/api/quote`.

`--json` data:

```json
{
  "network": "playground",
  "sell": {
    "symbol": "WETH",
    "address": "0x…",
    "amount": "1",
    "atomic": "1000000000000000000"
  },
  "buy": { "symbol": "USDC", "address": "0x…" },
  "midPrice": "2500",
  "midRatio": {
    "numerator": "2500000000",
    "denominator": "1000000000000000000"
  },
  "atMid": { "amount": "2500", "atomic": "2500000000" },
  "spreadBps": 50,
  "atSpread": { "amount": "2487.5", "atomic": "2487500000" },
  "fee": {
    "percent": "0.07",
    "amount": { "amount": "1.75", "atomic": "1750000" }
  },
  "dexSpreadPercent": "0.15"
}
```

`midPrice` is buy tokens per sell token to 18 significant digits; `midRatio` is Turbine's exact mid price in atomic units (buy per sell). Amounts are exact decimal strings plus atomic units. Human output rounds to 8 significant digits, and rounds the spread's floor down, so "at least" is never more than the order guarantees. `spreadBps` and `atSpread` are `null` without `--spread`. A Turbine error shows its code in brackets (and as `upstreamCode` in `--json`).

Status: done.

Acceptance:

- [x] Mid price, amount at mid, fee and DEX spread are computed exactly from Turbine's quote (`src/commands/quote.test.ts`, `src/turbine/amounts.test.ts`).
- [x] A spread gives the edge amount, positive and negative (`src/commands/quote.test.ts`).
- [x] Unknown tokens, the same token twice, bad amounts and bad spreads are refused in plain words, usage errors with exit 2 (`src/commands/quote.test.ts`, `src/cli.test.ts`).
- [x] Turbine's answers are validated; 502–504 read as unavailable, 501 as quoting switched off, an unreachable network as retryable; Turbine's error text is never shown (`src/turbine/http.test.ts`).
- [x] On mainnet, a config naming contracts other than Turbine's published settler and router is refused (`src/turbine/http.test.ts`).

### `turbine approve <token>`

The one-time ERC-20 approval that lets Permit2 move a token you sell; orders need it before they can settle.

Status: planned.

### `turbine order place <amount> <token> --for <token> --spread <bps> --ttl <duration> [--limit <price>]`

Places one spread order that tracks the mid price for its lifetime, with an optional limit price it will never trade beyond.

Status: planned.

### `turbine order watch <hash>`

A live terminal view of one order: its state, fills, and spread against the moving mid price.

Status: planned.

### `turbine orders [--status <list>] [--max <n>]`

Lists open and recent orders.

Status: planned.

### `turbine order cancel <hash>`

Cancels an open order.

Status: planned.

### `turbine ladder <amount> <token> --for <token> --levels <n> --from <bps> --to <bps> --ttl <duration>`

Splits an amount into several orders at evenly spaced spreads (price levels), the way a market maker quotes.

Status: planned.

### `turbine lp add|remove|status`

Adds liquidity to, removes it from, and shows its state in Turbine's liquidity pools.

Status: planned.

## Configuration

turbine-cli reads its settings from the environment you set up, and nowhere else. It deliberately doesn't read a `.env` from the current folder: a cloned repo or a download could then choose the wallet, the password or the endpoints. If you keep settings in a file you trust, load it into your shell yourself (`set -a; . ./my-settings; set +a`). `.env.example` lists every setting. An empty value means unset.

| Variable                  | Meaning                                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------------------------- |
| `TURBINE_NETWORK`         | `playground` (default). `mainnet` here alone is refused: mainnet needs `--network mainnet` on the command |
| `TURBINE_ACCOUNT`         | the wallet to use, by name (default `default`); `--account` wins                                          |
| `TURBINE_WALLET_PASSWORD` | the wallet password, for scripts and agents. `--password-file` is better                                  |
| `TURBINE_API_URL`         | a mock of the Turbine API on this computer only (`localhost`, `127.0.0.1`, `[::1]`), never on mainnet     |
| `TURBINE_RPC_URL`         | your own Ethereum RPC endpoint                                                                            |
| `TURBINE_NO_MOTION`       | `1` turns animation off, like `--no-motion`                                                               |

A wallet or password file that others can read is refused, with the command that fixes it (`chmod 600 <file>`). An API override pointing anywhere else is refused, because the API decides which contracts your wallet signs Permit2 allowances for.

## Agent skill

`skills/turbine/SKILL.md` teaches a coding agent (Claude Code or any agent that reads skills) to use turbine-cli through `--json`: quote first, always `--dry-run` and ask the human to confirm before any `place`, `ladder` or `cancel`, and stay on the playground unless told otherwise.

Status: planned.

## Not in scope

- A web interface (Turbine's own app is the web interface).
- Custody, key generation or key storage beyond reading one key.
- Strategies or bots that trade on their own without a human approving what is signed.

## Credits

Turbine is built by PropellerHeads. turbine-cli builds on the official [Turbine SDK](https://github.com/propeller-heads/turbine-sdk) and follows [Turbine's documentation](https://docs.turbine.exchange).
