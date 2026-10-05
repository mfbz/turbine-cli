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

// Settings come from the environment the user set up, and nowhere else. turbine-cli deliberately
// doesn't read a .env from the current folder: a cloned repo or a download would then choose the
// wallet, the password source or the endpoints. Values are never echoed in errors.
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

function readEnv(source: Source): Env {
  const raw: Record<string, string> = {};
  for (const [variable, field] of Object.entries(VARIABLES)) {
    const value = source[variable];
    // An empty value means unset. A password is kept exactly as given; anything else is trimmed.
    if (value?.trim())
      raw[field] = field === "walletPassword" ? value : value.trim();
  }
  const parsed = SCHEMA.safeParse(raw);
  if (!parsed.success) {
    throw new CliError("CONFIG_INVALID", {
      variable: variableFor(parsed.error.issues[0]?.path[0]),
    });
  }
  return parsed.data;
}

export { readEnv };
export type { Env };
