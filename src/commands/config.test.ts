import { describe, expect, it } from "vitest";

import { createTheme } from "../output/theme.ts";
import { configReport, renderConfig } from "./config.ts";

const PLAYGROUND = {
  name: "playground" as const,
  apiUrl: "https://playground-api.turbine.exchange/api",
  chainId: 1 as const,
};
const WALLET = {
  name: "trading",
  source: "turbine" as const,
  path: "/home/u/.config/turbine-cli/wallets/trading.json",
  address: "0x00000000000000000000000000000000000000aa" as const,
};

describe("turbine config", () => {
  it("names the wallet and its address, never its file contents", () => {
    expect(configReport(PLAYGROUND, WALLET)).toEqual({
      network: "playground",
      apiUrl: PLAYGROUND.apiUrl,
      rpcUrl: null,
      wallet: { name: "trading", address: WALLET.address, source: "turbine" },
    });
  });

  it("can't drive the terminal from a configured URL", () => {
    const report = configReport(
      { ...PLAYGROUND, rpcUrl: "https://rpc.example.com/\u001b]0;x\u0007" },
      undefined
    );
    expect(renderConfig(report, createTheme(0))).not.toMatch(/[\u001b\u0007]/);
  });

  it("says plainly whether funds are real", () => {
    const theme = createTheme(0);
    expect(renderConfig(configReport(PLAYGROUND, undefined), theme)).toContain(
      "simulated, no real funds"
    );
    const mainnet = { ...PLAYGROUND, name: "mainnet" as const };
    expect(renderConfig(configReport(mainnet, undefined), theme)).toContain(
      "real funds"
    );
  });
});
