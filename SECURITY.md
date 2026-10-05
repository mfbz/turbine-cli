# Security

turbine-cli signs orders with a wallet key, so security reports matter.

## Reporting

Please report vulnerabilities privately through GitHub's "Report a vulnerability" (Security → Advisories) on this repository. Don't open a public issue. We aim to reply within 7 days (a goal, not a promise: this is a small open-source project).

Vulnerabilities in Turbine itself (its API, contracts or web app) belong to Turbine, not here: see [Turbine's documentation](https://docs.turbine.exchange).

## In scope

- Loading the key (`TURBINE_PRIVATE_KEY`, `TURBINE_KEY_FILE`, `.env`) and keeping it out of every output.
- What gets signed and sent: `--dry-run`, network selection (playground by default), the mainnet confirmation.
- The user-facing agent skill's guardrails (quote first, dry-run, ask a human before signing).
- The guards, the Git hooks, CI and the release workflow.

## Design rules we hold ourselves to

- The playground is the default; mainnet needs `--network mainnet` and a confirmation showing amount, tokens, spread, limit and lifetime.
- `--dry-run` everywhere; nothing is ever signed silently.
- The key is never logged, printed, written or committed; a key file readable by others is refused.
- Use a dedicated wallet with a small balance. turbine-cli never needs your main wallet.

Details: [TURBINE-CLI.md](TURBINE-CLI.md#safety-design).

## If your key leaked

Move the funds to a new wallet now. A key that was ever pushed, pasted or logged can't be made secret again; removing it from Git history doesn't help.

There is no bug bounty.
