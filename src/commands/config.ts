import type { NetworkConfig, NetworkName } from "../config/network.ts";
import { plain } from "../output/output.ts";
import type { Theme } from "../output/theme.ts";
import type { WalletRef, WalletSource } from "../wallet/store.ts";

type ConfigReport = {
  network: NetworkName;
  apiUrl: string;
  rpcUrl: string | null;
  wallet: { name: string; address: string | null; source: WalletSource } | null;
};

function configReport(
  network: NetworkConfig,
  wallet: WalletRef | undefined
): ConfigReport {
  return {
    network: network.name,
    apiUrl: network.apiUrl,
    rpcUrl: network.rpcUrl ?? null,
    wallet: wallet
      ? { name: wallet.name, address: wallet.address, source: wallet.source }
      : null,
  };
}

function renderConfig(report: ConfigReport, theme: Theme): string {
  const network =
    report.network === "mainnet"
      ? `${theme.warning("▲ mainnet")} ${theme.dim("(real funds)")}`
      : `${theme.accent("playground")} ${theme.dim("(simulated, no real funds)")}`;
  const wallet = report.wallet
    ? `${report.wallet.name} ${report.wallet.address ?? ""} ${theme.dim(
        report.wallet.source === "foundry"
          ? "(Foundry keystore)"
          : "(encrypted)"
      )}`
    : theme.dim("no wallet: create one with turbine wallet new");
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
