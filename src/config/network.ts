import { CliError, maskKeys } from "../output/errors.ts";
import type { Env } from "./env.ts";

type NetworkName = "playground" | "mainnet";
type NetworkConfig = {
  name: NetworkName;
  apiUrl: string;
  chainId: 1;
  rpcUrl?: string;
};

// Both networks settle against Ethereum mainnet contracts; the playground simulates the settlement.
const API_URLS: Readonly<Record<NetworkName, string>> = {
  playground: "https://playground-api.turbine.exchange/api",
  mainnet: "https://api.turbine.exchange/api",
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function isNetwork(value: string): value is NetworkName {
  return value === "playground" || value === "mainnet";
}

function pickName(flag: string | undefined, env: Env): NetworkName {
  if (flag !== undefined) {
    if (!isNetwork(flag)) {
      throw new CliError(
        "USAGE",
        `Unknown network "${maskKeys(flag)}": use playground or mainnet.`,
        { exitCode: 2 }
      );
    }
    return flag;
  }
  // Real funds need a deliberate flag on the command itself, never a setting left in a file.
  if (env.network === "mainnet") {
    throw new CliError(
      "MAINNET_NEEDS_FLAG",
      "TURBINE_NETWORK=mainnet is set, but mainnet is only used when the command asks for it.",
      {
        hint: "Add --network mainnet to the command, or unset TURBINE_NETWORK.",
      }
    );
  }
  return "playground";
}

// The API's config names the contracts the wallet signs Permit2 allowances for, so an override could
// make a wallet approve a stranger's contract. Overrides exist for a mock on this computer only, and
// never on mainnet.
function checkOverride(apiUrl: string, name: NetworkName): void {
  const host = URL.canParse(apiUrl) ? new URL(apiUrl).hostname : "";
  if (name === "playground" && LOCAL_HOSTS.has(host)) return;
  throw new CliError(
    "API_URL_NOT_ALLOWED",
    name === "mainnet"
      ? "TURBINE_API_URL can't be used with mainnet."
      : "TURBINE_API_URL may only point at this computer (localhost or 127.0.0.1).",
    {
      hint: "The API decides which contracts your wallet signs for. Unset TURBINE_API_URL to use Turbine's own.",
    }
  );
}

function resolveNetwork(options: { flag?: string; env: Env }): NetworkConfig {
  const name = pickName(options.flag, options.env);
  if (options.env.apiUrl) checkOverride(options.env.apiUrl, name);
  // The SDK checks the API URL against the server's own, character for character.
  const apiUrl = (options.env.apiUrl ?? API_URLS[name]).replace(/\/+$/, "");
  const config: NetworkConfig = { name, apiUrl, chainId: 1 };
  if (options.env.rpcUrl) config.rpcUrl = options.env.rpcUrl;
  return config;
}

export { resolveNetwork };
export type { NetworkConfig, NetworkName };
