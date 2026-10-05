---
name: turbine
description: Use when a person asks you to quote, place, ladder, watch, list or cancel orders on Turbine (the private orderbook on Ethereum by PropellerHeads), or to approve a token for it, through the turbine command line. Covers the --json contract, dry runs, confirming with the person before anything is signed, wallets and passwords, networks, and what to do with each error.
---

# Using turbine-cli

turbine-cli places signed orders that can move real tokens. You prepare and explain; the person decides. Run everything with `--json`: stdout is then exactly one JSON document (`turbine order watch` streams one per line), and nothing on stdout is meant for a person.

## The rules

1. **Quote first.** `turbine quote <amount> <sell> <buy> --spread <bps> --json` before suggesting an order. It signs nothing and needs no wallet.
2. **Always dry-run first.** Run `turbine order place`, `turbine ladder`, `turbine order cancel` and `turbine approve` with `--dry-run --json` before the real thing. The dry run checks everything, signs nothing and needs no password.
3. **Show the person the summary and ask.** From the dry run, say in plain words: what is sold, the least received at today's mid (`atSpreadNow`), the spread, the limit (or that there is none), how long it lives, the network, and every warning. Run the real command only after the person says yes to that exact order. A yes to one order is not a yes to the next.
4. **Never handle keys or passwords.** Never ask for a private key, seed phrase or wallet password in chat, never put one in a command, a file or an environment variable, and never read wallet files. turbine-cli refuses a private key on the command line (`KEY_IN_ARGV`). The person unlocks the wallet themselves (see below).
5. **Stay on the playground.** It is the default and simulates fills. Use `--network mainnet` only when the person asks for mainnet in so many words, and say clearly that it uses real funds.
6. **Never add `--yes` on your own.** It skips the confirmations that protect real funds. Without a terminal turbine-cli needs it for anything on mainnet, for `turbine approve`, and for a playground order with a `REAL_FUNDS_EXPOSED`, `CHAIN_UNCHECKED` or `SETTLER_UNKNOWN` warning. Add it only after the person has seen that exact command's dry run and said yes to it.

## Commands

| What                                                           | Command                                                                                      |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Setup in use (network, wallet, API)                            | `turbine config --json`                                                                      |
| Wallets                                                        | `turbine wallet list --json`                                                                 |
| Supported tokens                                               | `turbine tokens --json`                                                                      |
| Mid price, fee, a spread's outcome                             | `turbine quote 1 WETH USDC --spread 20 --json`                                               |
| One order                                                      | `turbine order place 1 WETH --for USDC --spread 20 --ttl 1h [--limit 2400] --dry-run --json` |
| Several orders at evenly spaced spreads                        | `turbine ladder 10 WETH --for USDC --levels 5 --from -10 --to 30 --ttl 4h --dry-run --json`  |
| The wallet's orders                                            | `turbine orders [--status active] [--max 20] --json`                                         |
| Follow one order until it is done                              | `turbine order watch 0x… --json`                                                             |
| Cancel an order                                                | `turbine order cancel 0x… --dry-run --json`                                                  |
| Let Permit2 move a token (an Ethereum transaction, gas in ETH) | `turbine approve WETH --dry-run --json`                                                      |

Spreads are in basis points from the mid price: `50` means up to 0.5% worse than mid, `-10` means only fills at least 0.1% better. Durations are like `90s`, `30m`, `4h`, `2d`. Amounts are in whole tokens (`1.5`), never atomic units. Tokens are symbols or addresses. An order follows the market: only `--limit` sets a hard floor, so mention it when there is none (the `NO_LIMIT` warning).

`turbine order watch --json` prints `{ "type": "state", "order", "mid" }` on each change and `{ "type": "final", … }` when the order is done; it can run for hours, so tell the person rather than wait on it silently.

## Wallets and passwords

Creating or importing a wallet needs the person at a terminal: ask them to run `turbine wallet new` (or `turbine wallet import`) themselves. Use `--account <name>` to pick a wallet.

Signing (`order place`, `ladder`, `order cancel`, `approve`) and reading orders (`orders`, `order watch`) unlock the wallet. Without a terminal, the password comes from a file the person made, passed as `--password-file <path>` (the file must be `chmod 600`), or from `TURBINE_WALLET_PASSWORD` set by the person in their own shell. If you get `PASSWORD_REQUIRED`, tell the person those two options; don't offer to hold the password for them.

## Reading the result

Success is `{ "ok": true, "data": … }`. Failure is `{ "ok": false, "error": { "code", "message", "hint", "retryable", "upstreamCode"? } }`, and the exit code is not 0 (`2` for a usage error, `130` when cancelled or interrupted). Branch on `error.code`, never on the wording. `message` and `hint` are written for the person: pass them on.

- `retryable: true` (`NETWORK_UNREACHABLE`, `SERVICE_BUSY`, `SERVICE_UNAVAILABLE`, `QUOTE_UNAVAILABLE`, `REQUEST_FAILED`, `RPC_UNREACHABLE`): wait a little and try the same read again, a few times at most. Never retry a signing command this way.
- `ORDER_OUTCOME_UNKNOWN` or `CANCEL_OUTCOME_UNKNOWN`: it was signed and sent, but the answer was lost. **Do not place or cancel again.** Run `turbine orders --json` and tell the person what it shows.
- `APPROVAL_PARTIAL`: the first of two approval transactions went through; tell the person and show the hash.
- `CONFIRMATION_REQUIRED`: this needs the person's explicit confirmation (rule 6). Show the dry run and ask; add `--yes` only if they say yes.
- `ALLOWANCE_MISSING`: on mainnet the token needs `turbine approve <token>` first: dry-run it and ask, since it costs gas.
- `BALANCE_TOO_LOW`, `AMOUNT_TOO_SMALL`, `LEVEL_TOO_SMALL`, `TTL_TOO_SHORT`, `TTL_TOO_LONG`, `SPREADS_TOO_CLOSE`: adjust the numbers with the person, then dry-run again.
- `KEY_IN_ARGV`: something that looks like a private key reached the command line. Remove it; never retry with it.
- `API_REJECTED`: Turbine refused it; `upstreamCode` is Turbine's own code. Tell the person; don't guess around it.

Warnings in a dry run's `warnings` list are not errors, but each one goes to the person. `REAL_FUNDS_EXPOSED` matters most: the playground signature would also be valid on mainnet for that wallet's real tokens, so suggest a fresh wallet for the playground. `SETTLER_UNKNOWN` means the playground names a contract that isn't Turbine's: say so plainly before anything is signed.
