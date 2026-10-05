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
- Exit codes: `0` done, `1` failed, `2` usage error (an unknown command or flag, a bad value), `130` interrupted (Ctrl-C, including at a prompt; with `--json`, still one document, `INTERRUPTED`, whose hint says to check `turbine orders`: an interrupt can land after something was sent).
- Error messages and hints come only from turbine-cli's catalogue (stable `code`s for agents to branch on, plus `retryable`). An unknown API error is `API_REJECTED`, with the API's code in `upstreamCode` only if it is a plain `SCREAMING_SNAKE` word. `--debug` adds the error's class and stack frames on stderr, never in the `--json` document and never values.
- A private key typed as an argument is refused (`KEY_IN_ARGV`, exit 2) without being echoed. The key and the wallet password never appear in any output. Text from the Turbine API is stripped of control characters before it reaches a terminal.

## Commands

Flags, the `--json` shape and acceptance checks are added to each command here with the change that builds it.

### `turbine` (the interactive session)

`turbine` with no arguments, in a terminal, opens the session: Turbine's logo with the mark turning (DESIGN.md, "The header"), then a menu of the same actions the direct commands run. Today: get a quote, place an order, build a ladder, my orders, watch an order, cancel an order, approve a token, supported tokens, show my setup, my wallets, create or import a wallet, switch network. Each command that lands adds its own entry.

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

### `turbine approve <token> [--amount <amount>]`

The one-time ERC-20 approval that lets Permit2 (Uniswap's `0x000000000022D473030F116dDEE9F6B43aC78BA3`) move a token you sell; orders can't settle without it. It is an **Ethereum transaction**, paid in ETH gas, whichever `--network` you use, so it always asks first: a confirmation in a terminal, or `--yes` without one. `--dry-run` shows the exact transaction instead. Unlimited by default (as Permit2 is designed for); `--amount` approves only that much. Nothing is sent when the allowance is already enough. USDT, which refuses to change a non-zero allowance, gets a reset to zero first.

`--json` data: `{ "status": "already-approved", "token", "allowance" }`, `{ "status": "dry-run", "token", "transactions": [{ "chainId": 1, "to", "data", "spender", "amount" }] }` or `{ "status": "approved", "token", "transactions": ["0x…"] }`.

Status: done.

### `turbine order place <amount> <token> --for <token> --spread <bps> --ttl <duration> [--limit <price>]`

Places one spread order: it sells `<amount>` of `<token>` for the `--for` token at the mid price minus `--spread` basis points (negative: only better than mid), following the market for `--ttl` (24 s to 30 days; `90s`, `30m`, `4h`, `2d`; the Permit2 allowance lasts as long, which is why it is capped). `--limit` is a hard floor in buy tokens per sell token; without it nothing but the spread protects the price, and the summary says so.

Before anything is signed it checks the tokens, Turbine's $10 minimum, the lifetime and the limit, and, on Ethereum, the wallet's balance and Permit2 allowance (on mainnet a shortfall stops it; on the playground, where settlement is simulated, it is a warning). Then it shows what will be signed:

1. **A Permit2 allowance**: _unlimited_ for the token sold, to Turbine's settler (on mainnet, pinned to Turbine's published address; on the playground, a different settler is the `SETTLER_UNKNOWN` warning), until the order ends. Turbine asks for unlimited so the amount stays private.
2. **The order itself**, signed as an EIP-712 request and sent to Turbine.

- `--dry-run` runs Turbine's own SDK with an account that records these two payloads and signs nothing; it stops before anything is sent and needs no password. With `--json` the exact typed data is in `sign`.
- Mainnet asks for a confirmation in a terminal, or needs `--yes` without one. So does a playground order when the wallet holds any of that token on Ethereum (approved or not yet), or when that can't be checked, or when the playground names a settler that isn't Turbine's, because the playground's allowance signature is valid on Ethereum too until the order ends: use a fresh wallet for the playground.
- Then the wallet is unlocked (prompt, `--password-file` or `TURBINE_WALLET_PASSWORD`), its address is checked against the keystore's, and the order goes through the SDK.
- If anything fails after the order itself was signed, it may have been placed: the error is `ORDER_OUTCOME_UNKNOWN`, never retryable, and says to check `turbine orders` before placing it again.

`--json` data: `{ "dryRun": true, "order": {…}, "sign": [{ "purpose": "permit2-allowance" | "order", "typedData": {…} }] }` or `{ "dryRun": false, "order": {…}, "hash": "0x…" }`, where `order` is the summary: `network`, `wallet`, `sell`, `buy`, `midPrice`, `atMid`, `spreadBps`, `atSpreadNow` (at today's mid; the order follows the market), `limit` (`{ price, minBuy }` or `null`), `lifetime` (`{ seconds, endsAt }`), `feePercent`, `permit2` (`{ token, spender, amount: "unlimited", expiresAt }`) and `warnings` (`[{ code, message }]`).

Status: done.

Acceptance:

- [x] A dry run captures exactly the Permit2 allowance and the order the SDK builds, sends nothing, and needs no password (`src/turbine/sdk-orders.test.ts`, which runs the real SDK; `src/cli.test.ts`).
- [x] A real placement signs both, sends the order once, and returns its hash; an SDK config naming a different settler is refused before signing (`src/turbine/sdk-orders.test.ts`).
- [x] Amounts, the limit floor (rounded up), lifetime, spread and the minimum trade are checked before anything is signed (`src/turbine/order-plan.test.ts`).
- [x] Mainnet, and a playground order exposing real tokens, need a confirmation or `--yes` (`src/cli.test.ts`, `src/turbine/order-plan.test.ts`).
- [x] `turbine approve` dry-runs the exact transaction and sends only after a confirmation or `--yes`; nothing is sent when already approved (`src/cli.test.ts`, `src/turbine/chain.test.ts`).

### `turbine order watch <hash>`

Follows one order until it is filled, expires, is cancelled or turns invalid. It unlocks the wallet once (reading orders is a signed query), keeps one connection, and polls the order every 3 s and the mid price every 6 s. A few transient failures (Turbine or the RPC briefly unreachable) are ridden out with growing pauses; a lasting one, or a real rejection, ends the watch with its error.

- **In a terminal**: a full-screen live view: status, a fill bar with what was sold for what, mid against your limit, time left, the latest fills. Keys work at once, even while a request is in flight: `q` stops watching (the order carries on; exit 0), Ctrl-C does the same as an interrupt (exit 130), `c` asks, then cancels the order with the wallet already unlocked. The live view needs a terminal on both ends; otherwise it prints lines. The shell's screen and cursor come back as they were, with a one-line summary.
- **Piped**: one plain line per change.
- **`--json`**: the one stream in turbine-cli: one JSON object per line, `{ "type": "state", "order": {…}, "mid" }` on each change and `{ "type": "final", "order": {…}, "mid" }` when the order is done, where `order` has the shape `turbine orders` uses. An error ends the stream with the usual `{ "ok": false, "error" }` document.

Status: done.

Acceptance:

- [x] One event per change, a final event when done; one line per change when piped; `q` stops and `c` cancels in the live view (`src/commands/watch.test.ts`, `src/cli.test.ts`).
- [x] The view shows status, fills, mid against the limit and time left within the terminal's width (`src/commands/watch.test.ts`).
- [x] Text from Turbine's API (hashes, statuses) is held to its expected shape before it reaches a terminal or an agent (`src/commands/orders.test.ts`).

### `turbine orders [--status <list>] [--max <n>]`

The wallet's orders, newest first: status, pair, how much has filled, time left. `--status` takes plain words (`active`, `filled`, `expired`, `cancelled`, `cancelling`, `invalid`, comma-separated); `--max` is 1 to 200 (default 20). Turbine only answers signed queries, so this unlocks the wallet (prompt, `--password-file` or `TURBINE_WALLET_PASSWORD`), but signs nothing that can move funds.

`--json` data, one object per order: `{ "hash", "status", "sell": { "symbol", "address", "amount", "atomic" }, "buy": { "symbol", "address" }, "sold", "bought", "filledPercent", "limitPrice", "createdAt", "endsAt", "secondsLeft", "fills": [{ "txHash", "clearedAt", "sold", "bought", "price" }] }`. Fields Turbine doesn't return for an order are `null`.

Status: done.

### `turbine order cancel <hash>`

Cancels an open order with a signed request. Turbine applies it after the Speedbump (about 12 s); until then the order reads `cancelling`. `--dry-run` shows the exact request and needs no password; mainnet asks first (or needs `--yes` without a terminal). If the request was sent but its answer couldn't be read, the error is `CANCEL_OUTCOME_UNKNOWN`: check `turbine orders` before cancelling again.

An order hash is the one place turbine-cli accepts 64 hexadecimal characters on the command line, and only in its `0x…` form after `order cancel` or `order watch`; anywhere else such a value is refused as a possible private key.

`--json` data: `{ "dryRun": true, "hash", "sign": [{ "purpose": "cancel", "typedData" }] }` or `{ "dryRun": false, "hash", "status": "cancelling" }`.

Status: done.

Acceptance:

- [x] Orders are read with a signed query through the SDK, fills with their time (`src/turbine/sdk-orders.test.ts`), and reported with exact amounts, filled share, limit and time left (`src/commands/orders.test.ts`).
- [x] A cancel dry-runs without sending, sends once for real, and asks first on mainnet (`src/turbine/sdk-orders.test.ts`, `src/cli.test.ts`).
- [x] An order hash after `order cancel` is accepted; a key-shaped value anywhere else is still refused (`src/cli.test.ts`).

### `turbine ladder <amount> <token> --for <token> --levels <n> --from <bps> --to <bps> --ttl <duration> [--limit <price>]`

Splits `<amount>` into `--levels` orders (2 to 20, a whole number) at evenly spaced spreads from `--from` (the first level) to `--to` (the last) basis points; a descending ladder works too, and halves round away from zero. Every level needs its own spread, so spreads too close for that many levels are `SPREADS_TOO_CLOSE`, the way a market maker quotes: `--from -10 --to 30 --levels 5` places orders at -10, 0, 10, 20 and 30 bps. The amount is split evenly, the rounding remainder going to the last level, so the ladder sells exactly what you asked. `--limit` applies one price floor to every level.

It runs the same checks as `turbine order place` once for the whole amount, then makes sure each level on its own clears Turbine's minimum trade. The summary lists every level; each signs its own Permit2 allowance and order, and all are sent as **one signed batch**. `--dry-run` shows every level's exact typed data; mainnet, or a playground wallet with real tokens exposed, asks first. The summary gives the spread range, the total at today's mid (the sum of the levels) and says how many things you sign (two per order). A failure after signing, or Turbine confirming fewer orders than were sent, is `ORDER_OUTCOME_UNKNOWN` for the whole ladder: check `turbine orders`.

`--json` data: `{ "dryRun": true, "ladder": {…}, "sign": [[…], …] }` or `{ "dryRun": false, "ladder": {…}, "hashes": ["0x…", …] }`, where `ladder` is the order summary of `turbine order place` with `spreadFromBps` and `spreadToBps` instead of `spreadBps`, `atSpreadNow` summed over the levels, plus `orders` and `levels: [{ "spreadBps", "sell", "atSpreadNow", "minBuy" }]`.

Status: done.

Acceptance:

- [x] Spreads are evenly spaced, the amount split exactly with the remainder last, each level held to the minimum, and a limit sized to each level (`src/turbine/ladder.test.ts`).
- [x] A dry run captures every level's signatures through the real SDK and sends nothing; a real ladder goes as one batch (`src/turbine/sdk-orders.test.ts`, `src/cli.test.ts`).
- [x] Mainnet asks first (`src/cli.test.ts`).

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

`skills/turbine/SKILL.md` teaches a coding agent (Claude Code, or any agent that reads Agent Skills) to use turbine-cli through `--json`: quote first, always `--dry-run`, show the person the summary and ask before any `place`, `ladder`, `cancel` or `approve`, never handle keys or passwords, stay on the playground unless told otherwise, and branch on `error.code` and `retryable` (an `ORDER_OUTCOME_UNKNOWN` means checking `turbine orders`, never placing again). It ships in the npm package; copy the `skills/turbine` folder into your agent's skills folder (for Claude Code, `~/.claude/skills/` or a project's `.claude/skills/`).

Status: done.

Acceptance:

- [x] The skill is a valid Agent Skill and ships in the package (`tools/checks/agents-repo.test.ts`).
- [x] Every error code, warning, environment variable and flag it names exists in turbine-cli (`tools/checks/agents-repo.test.ts`).

## Not in scope

- A web interface (Turbine's own app is the web interface).
- Custody: wallets stay encrypted on your computer, and turbine-cli never sends a key anywhere.
- Strategies or bots that trade on their own without a human approving what is signed.

## Credits

Turbine is built by PropellerHeads. turbine-cli builds on the official [Turbine SDK](https://github.com/propeller-heads/turbine-sdk) and follows [Turbine's documentation](https://docs.turbine.exchange).
