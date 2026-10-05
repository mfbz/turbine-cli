# turbine-cli

An unofficial command line for [Turbine](https://docs.turbine.exchange), the private orderbook on Ethereum: quote, place, ladder and watch spread orders from your terminal or your agent.

> turbine-cli is an unofficial community tool, not affiliated with or endorsed by Turbine or PropellerHeads.

**Status: in development.** What it does and how it behaves is described in [TURBINE-CLI.md](TURBINE-CLI.md).

## Safety first

- **Playground by default.** Turbine's playground is simulated: no real funds. Mainnet needs `--network mainnet` and a confirmation on every order.
- **`--dry-run` everywhere.** See exactly what would be signed and sent, without sending it.
- **Your key stays encrypted.** Wallets are encrypted keystores (`turbine wallet new` or `turbine wallet import`), unlocked with a password; a raw key is never read from an argument, a variable or a file. Use a dedicated wallet with a small balance.

## License

[MIT](LICENSE)
