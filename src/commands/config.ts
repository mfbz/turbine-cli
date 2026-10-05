import type { NetworkConfig, NetworkName } from "../config/network.ts";
import { plain } from "../output/output.ts";
import type { Theme } from "../output/theme.ts";
import type { KeySource, LoadedKey } from "../wallet/key.ts";

type ConfigReport = {
  network: NetworkName;
  apiUrl: string;
  rpcUrl: string | null;
  wallet: { address: string; source: KeySource } | null;
};

const SOURCE_NAMES: Readonly<Record<KeySource, string>> = {
  env: "TURBINE_PRIVATE_KEY",
  file: "TURBINE_KEY_FILE",
};

function configReport(
  network: NetworkConfig,
  key: LoadedKey | undefined
): ConfigReport {
  return {
    network: network.name,
    apiUrl: network.apiUrl,
    rpcUrl: network.rpcUrl ?? null,
    wallet: key ? { address: key.address, source: key.source } : null,
  };
}

function renderConfig(report: ConfigReport, theme: Theme): string {
  const network =
    report.network === "mainnet"
      ? `${theme.warning("mainnet")} ${theme.dim("(real funds)")}`
      : `${theme.accent("playground")} ${theme.dim("(simulated, no real funds)")}`;
  const wallet = report.wallet
    ? `${report.wallet.address} ${theme.dim(`(from ${SOURCE_NAMES[report.wallet.source]})`)}`
    : theme.dim("no wallet: set TURBINE_PRIVATE_KEY or TURBINE_KEY_FILE");
  const rows: Array<[string, string]> = [
    ["network", network],
    // Configured values can come from files the user didn't write; never let them drive the terminal.
    ["api", plain(report.apiUrl)],
    ["rpc", report.rpcUrl ? plain(report.rpcUrl) : theme.dim("default")],
    ["wallet", wallet],
  ];
  return rows
    .map(([label, value]) => `${theme.dim(label.padEnd(8))}${value}`)
    .join("\n");
}

export { configReport, renderConfig };
export type { ConfigReport };
