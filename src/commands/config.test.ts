import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";

import { createTheme } from "../output/theme.ts";
import { configReport, renderConfig } from "./config.ts";

const PLAYGROUND = {
  name: "playground" as const,
  apiUrl: "https://playground-api.turbine.exchange/api",
  chainId: 1 as const,
};

describe("turbine config", () => {
  it("reports the wallet's address and where the key came from, never the key", () => {
    const privateKey = generatePrivateKey();
    const { address } = privateKeyToAccount(privateKey);
    const report = configReport(PLAYGROUND, {
      privateKey,
      address,
      source: "file",
    });
    expect(report).toEqual({
      network: "playground",
      apiUrl: PLAYGROUND.apiUrl,
      rpcUrl: null,
      wallet: { address, source: "file" },
    });
    expect(JSON.stringify(report)).not.toContain(privateKey.slice(2));
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
