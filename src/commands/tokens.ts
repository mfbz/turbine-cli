import type { Theme } from "../output/theme.ts";
import type { Token, TurbineApi } from "../turbine/api.ts";

async function tokensCommand(api: TurbineApi): Promise<Token[]> {
  return (await api.info()).tokens;
}

function renderTokens(tokens: readonly Token[], theme: Theme): string {
  if (tokens.length === 0) return theme.dim("No tokens on this network.");
  const width = Math.max(...tokens.map((t) => t.symbol.length)) + 2;
  return tokens
    .map(
      (t) =>
        `${theme.bold(t.symbol.padEnd(width))}${t.address}  ${theme.dim(
          `${t.decimals} decimals${t.tokenClass ? ` · ${t.tokenClass.toLowerCase()}` : ""}`
        )}`
    )
    .join("\n");
}

export { renderTokens, tokensCommand };
