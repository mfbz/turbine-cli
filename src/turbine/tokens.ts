import { CliError } from "../output/errors.ts";
import type { Token } from "./api.ts";

/** A token by symbol (any case) or address, from the tokens Turbine supports on this network. */
function resolveToken(input: string, tokens: readonly Token[]): Token {
  const wanted = input.trim().toLowerCase();
  const found = tokens.find(
    (t) =>
      t.symbol.toLowerCase() === wanted || t.address.toLowerCase() === wanted
  );
  if (!found) throw new CliError("TOKEN_UNKNOWN", { token: input });
  return found;
}

function resolvePair(
  sell: string,
  buy: string,
  tokens: readonly Token[]
): { sell: Token; buy: Token } {
  const pair = {
    sell: resolveToken(sell, tokens),
    buy: resolveToken(buy, tokens),
  };
  if (pair.sell.address === pair.buy.address) throw new CliError("SAME_TOKEN");
  return pair;
}

export { resolvePair, resolveToken };
