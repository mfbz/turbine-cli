# Security

turbine-cli signs orders with a wallet key, so security reports matter.

## Reporting

Please report vulnerabilities privately through GitHub's "Report a vulnerability" (Security → Advisories) on this repository. Don't open a public issue. We aim to reply within 7 days (a goal, not a promise: this is a small open-source project).

Vulnerabilities in Turbine itself (its API, contracts or web app) belong to Turbine, not here: see [Turbine's documentation](https://docs.turbine.exchange).

## In scope

- Wallets: the encrypted keystores (`turbine wallet new|import`), unlocking (`--password-file`, `TURBINE_WALLET_PASSWORD`, the hidden prompt), and keeping keys and passwords out of every output.
- Error output: messages come only from turbine-cli's catalogue, never from a library or the API.
- What gets signed and sent: `--dry-run`, network selection (playground by default), the mainnet confirmation.
- The user-facing agent skill's guardrails (quote first, dry-run, ask a human before signing).
- The guards, the Git hooks, CI and the release workflow.

## Design rules we hold ourselves to

- The playground is the default; mainnet needs `--network mainnet` and a confirmation showing amount, tokens, spread, limit and lifetime.
- `--dry-run` everywhere; nothing is ever signed silently.
- Keys are stored only encrypted (Web3 Secret Storage v3, scrypt), in files only you can read. A raw key is never read from an argument, a variable or a file; a key-shaped argument is refused.
- The key and password are never logged, printed or committed, and error messages never repeat a library's or the API's text.
- Use a dedicated wallet with a small balance. turbine-cli never needs your main wallet.

Details: [TURBINE-CLI.md](TURBINE-CLI.md#safety-design).

## If your key leaked

Move the funds to a new wallet now. A key that was ever pushed, pasted or logged can't be made secret again; removing it from Git history doesn't help.

There is no bug bounty.
