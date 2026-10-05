import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";

import { z } from "zod";

import { CliError } from "../output/errors.ts";

type Env = {
  network?: "playground" | "mainnet";
  account?: string;
  walletPassword?: string;
  apiUrl?: string;
  rpcUrl?: string;
};
type Source = Record<string, string | undefined>;

// Variable → field. Values are never echoed in errors: one of them is a wallet password.
const VARIABLES = {
  TURBINE_NETWORK: "network",
  TURBINE_ACCOUNT: "account",
  TURBINE_WALLET_PASSWORD: "walletPassword",
  TURBINE_API_URL: "apiUrl",
  TURBINE_RPC_URL: "rpcUrl",
} as const;
const SCHEMA = z.object({
  network: z.enum(["playground", "mainnet"]).optional(),
  account: z.string().optional(),
  walletPassword: z.string().optional(),
  apiUrl: z.url().optional(),
  rpcUrl: z.url().optional(),
});

function variableFor(field: PropertyKey | undefined): string {
  const entry = Object.entries(VARIABLES).find(([, f]) => f === field);
  return entry?.[0] ?? String(field);
}

// Where turbine-cli talks to. A .env travels with whatever folder you run turbine in (a cloned repo,
// a download), so these only come from the environment you set up yourself.
const ENDPOINTS = ["TURBINE_API_URL", "TURBINE_RPC_URL"] as const;

function readEnv(source: Source, dotenvText?: string): Env {
  const dotenv: Source = dotenvText ? parseEnv(dotenvText) : {};
  const endpoint = ENDPOINTS.find((name) => dotenv[name]?.trim());
  if (endpoint)
    throw new CliError("ENDPOINT_IN_DOTENV", { variable: endpoint });
  // A wallet password in a file anyone might commit or ship is a password already shared.
  if (dotenv.TURBINE_WALLET_PASSWORD?.trim())
    throw new CliError("PASSWORD_IN_DOTENV");
  // The real environment wins over .env, like most tools that read one.
  const merged: Source = { ...dotenv, ...source };
  const raw: Record<string, string> = {};
  for (const [variable, field] of Object.entries(VARIABLES)) {
    const value = merged[variable]?.trim();
    // An empty value means unset: a .env copied from .env.example has every key, most of them empty.
    if (value) raw[field] = value;
  }
  const parsed = SCHEMA.safeParse(raw);
  if (!parsed.success) {
    throw new CliError("CONFIG_INVALID", {
      variable: variableFor(parsed.error.issues[0]?.path[0]),
    });
  }
  return parsed.data;
}

function loadEnv(options: { env: Source; cwd: string }): Env {
  const path = join(options.cwd, ".env");
  const dotenvText = existsSync(path) ? readFileSync(path, "utf8") : undefined;
  return readEnv(options.env, dotenvText);
}

export { loadEnv, readEnv };
export type { Env };
