import { CliError } from "../output/errors.ts";
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

function isNetwork(value: string): value is NetworkName {
  return value === "playground" || value === "mainnet";
}

function pickName(flag: string | undefined, env: Env): NetworkName {
  if (flag !== undefined) {
    if (!isNetwork(flag)) {
      throw new CliError(
        "USAGE",
        `Unknown network "${flag}": use playground or mainnet.`,
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

function resolveNetwork(options: { flag?: string; env: Env }): NetworkConfig {
  const name = pickName(options.flag, options.env);
  // The SDK checks the API URL against the server's own, character for character.
  const apiUrl = (options.env.apiUrl ?? API_URLS[name]).replace(/\/+$/, "");
  const config: NetworkConfig = { name, apiUrl, chainId: 1 };
  if (options.env.rpcUrl) config.rpcUrl = options.env.rpcUrl;
  return config;
}

export { resolveNetwork };
export type { NetworkConfig, NetworkName };
