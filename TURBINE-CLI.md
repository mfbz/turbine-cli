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
- **Keys stay yours.** The signing key comes from the `TURBINE_PRIVATE_KEY` environment variable or an owner-only key file (`TURBINE_KEY_FILE`). It is never logged, printed or written anywhere, and is redacted from every output, including errors and `--json`.
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
- Exit codes: `0` done, `1` failed, `2` usage error (an unknown command or flag, a bad value), `130` interrupted.
- The signing key never appears in any output, in any mode. Text from the Turbine API is stripped of control characters before it reaches a terminal.

## Commands

Flags, the `--json` shape and acceptance checks are added to each command here with the change that builds it.

### `turbine config`

Shows what turbine-cli will use: the network, the Turbine API, the RPC endpoint, and the wallet (its address and where the key came from, never the key). The quickest way to check a setup before anything is signed.

`--json` data:

```json
{
  "network": "playground",
  "apiUrl": "https://playground-api.turbine.exchange/api",
  "rpcUrl": null,
  "wallet": { "address": "0x…", "source": "env" }
}
```

`wallet` is `null` without a key; `source` is `env` (`TURBINE_PRIVATE_KEY`) or `file` (`TURBINE_KEY_FILE`).

Status: done.

Acceptance:

- [x] The playground is the default, and the output says the funds are simulated (`src/cli.test.ts` "shows the playground by default", `src/commands/config.test.ts`).
- [x] `--json` returns the shape above (`src/cli.test.ts` "returns the setup as JSON").
- [x] The key appears in no output, human, `--json` or `--debug`, including when the command fails (`src/cli.test.ts` "never prints its key, in any mode").
- [x] `TURBINE_NETWORK=mainnet` without `--network mainnet` is refused (`src/cli.test.ts`, `src/config/network.test.ts`).
- [x] No colour codes when piped (`src/cli.test.ts` "writes no colour codes when piped").

### `turbine tokens`

The tokens Turbine supports on the selected network.

Status: planned.

### `turbine quote <amount> <sell> <buy> [--spread <bps>]`

The current mid price for a pair, the fee, and what a given spread would mean in price and amount received.

Status: planned.

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

turbine-cli reads its settings from the environment, and from a `.env` file in the folder it runs in when there is one; the environment wins over `.env`. `.env.example` lists them all. An empty value means unset. The two endpoints (`TURBINE_API_URL`, `TURBINE_RPC_URL`) are only read from the environment, never from `.env`: a `.env` can come with any folder.

| Variable              | Meaning                                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------------------------- |
| `TURBINE_NETWORK`     | `playground` (default). `mainnet` here alone is refused: mainnet needs `--network mainnet` on the command |
| `TURBINE_PRIVATE_KEY` | the signing key of a dedicated wallet, with or without `0x`                                               |
| `TURBINE_KEY_FILE`    | path to a file holding the key instead; it must be owner-only (600). Set one of the two, not both         |
| `TURBINE_API_URL`     | a mock of the Turbine API on this computer only (`localhost`, `127.0.0.1`, `[::1]`), never on mainnet     |
| `TURBINE_RPC_URL`     | your own Ethereum RPC endpoint                                                                            |
| `TURBINE_NO_MOTION`   | `1` turns animation off, like `--no-motion`                                                               |

A key file that others can read is refused, with the command that fixes it (`chmod 600 <file>`). An API override pointing anywhere else is refused, because the API decides which contracts your wallet signs Permit2 allowances for.

## Agent skill

`skills/turbine/SKILL.md` teaches a coding agent (Claude Code or any agent that reads skills) to use turbine-cli through `--json`: quote first, always `--dry-run` and ask the human to confirm before any `place`, `ladder` or `cancel`, and stay on the playground unless told otherwise.

Status: planned.

## Not in scope

- A web interface (Turbine's own app is the web interface).
- Custody, key generation or key storage beyond reading one key.
- Strategies or bots that trade on their own without a human approving what is signed.

## Credits

Turbine is built by PropellerHeads. turbine-cli builds on the official [Turbine SDK](https://github.com/propeller-heads/turbine-sdk) and follows [Turbine's documentation](https://docs.turbine.exchange).
