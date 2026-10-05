// What turbine-cli needs from Turbine, as one interface. Commands depend on this, never on HTTP or
// the SDK, so every command can be tested against an in-memory fake.
import type { Hex } from "../wallet/signer.ts";
import type { Ratio } from "./amounts.ts";

type Token = {
  address: Hex;
  symbol: string;
  decimals: number;
  tokenClass: "Regular" | "Stable" | "Meme" | null;
};
type ProtocolInfo = {
  version: string;
  settler: Hex;
  lpRouter: Hex;
  tokens: Token[];
  minTradeUsdc: bigint;
  maxSignatureLifetimeS: number;
};
type Quote = {
  sellAmount: bigint;
  buyAmount: bigint;
  // Buy-token atomic units per sell-token atomic unit.
  mid: Ratio;
  // What swapping on DEXes would cost now, in hundredths of a basis point.
  dexSpreadHbp: number;
  gasHbp: number;
  // Turbine's fee for this trade.
  feeHbp: number;
  feeAmount: bigint;
};
type TurbineApi = {
  info(): Promise<ProtocolInfo>;
  quote(sellToken: Hex, buyToken: Hex, sellAmount: bigint): Promise<Quote>;
};

export type { ProtocolInfo, Quote, Token, TurbineApi };
