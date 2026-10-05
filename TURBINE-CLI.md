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
- Exit codes: `0` done, `1` failed, `2` usage error (an unknown command or flag, a bad value), `130` interrupted.
- Error messages and hints come only from turbine-cli's catalogue (stable `code`s for agents to branch on, plus `retryable`). An unknown API error is `API_REJECTED`, with the API's code in `upstreamCode` only if it is a plain `SCREAMING_SNAKE` word. `--debug` adds the error's class and stack frames on stderr, never in the `--json` document and never values.
- A private key typed as an argument is refused (`KEY_IN_ARGV`, exit 2) without being echoed. The key and the wallet password never appear in any output. Text from the Turbine API is stripped of control characters before it reaches a terminal.

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
  "wallet": { "name": "default", "address": "0x…", "source": "turbine" }
}
```

`wallet` is `null` when there is no wallet yet; `address` is the one its keystore declares (the wallet isn't unlocked to show it); `source` is `turbine` or `foundry`. A wallet asked for by name (`--account`, `TURBINE_ACCOUNT`) must exist.

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
- `[name]` defaults to `default`; names use letters, digits, `-` and `_`. A wallet is never overwritten.
- Other commands pick the wallet with `--account <name>` or `TURBINE_ACCOUNT`, and unlock it with the hidden prompt, `--password-file <file>` (chmod 600) or `TURBINE_WALLET_PASSWORD` from the shell. Without a terminal and without a password they fail at once (`PASSWORD_REQUIRED`) rather than wait.

`--json` data: `new` and `import` return `{ "name", "address", "path" }`; `list` returns `[{ "name", "address", "source", "path" }]`.

Status: done.

Acceptance:

- [x] Keystores round-trip, a wrong password or a tampered file is refused, and the format reads the Web3 Secret Storage test vector (`src/wallet/keystore.test.ts`).
- [x] Files are created 600 in a 700 folder, never overwritten, and names can't become paths (`src/wallet/store.test.ts`).
- [x] Without a terminal or a password, commands fail instead of waiting; a `.env` in the current folder is ignored (`src/wallet/signer.test.ts`, `src/cli.test.ts`).
- [x] An imported key and the password never appear in any output (`src/cli.test.ts` "imports a key only through a hidden prompt").

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
