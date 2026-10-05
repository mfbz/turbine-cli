// Turbine's public HTTP endpoints (/api/config, /api/quote), which need no wallet. Every answer is
// validated before use; anything unexpected becomes a catalogue error, never the server's own text.
import { getAddress } from "viem";
import { z } from "zod";

import type { NetworkConfig, NetworkName } from "../config/network.ts";
import { CliError } from "../output/errors.ts";
import type { Hex } from "../wallet/signer.ts";
import type { ProtocolInfo, Quote, TurbineApi } from "./api.ts";

type Fetch = typeof globalThis.fetch;

const TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
// Turbine's current mainnet contracts. The API's config decides who the wallet's Permit2 allowances are
// for, so on mainnet it must agree with these. Turbine redeploys now and then (the SDK's
// migrate-liquidity script lists the retired settlers): a new deployment means updating these, after
// checking the API serves it and it is onchain, never trusting whatever the API says.
const PINNED: Partial<Record<NetworkName, { settler: Hex; lpRouter: Hex }>> = {
  mainnet: {
    settler: getAddress("0x5964336d54486f70b6a05b7825021427d99a0e16"),
    lpRouter: getAddress("0xe5b67a998b73c5a5817f56c22b433c4642b7262a"),
  },
};

const ADDRESS = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((a) => getAddress(a));
const UINT = z
  .string()
  .regex(/^\d{1,78}$/)
  .transform((n) => BigInt(n));
const CONFIG = z.object({
  version: z.string().max(64),
  turbineSettlerAddress: ADDRESS,
  lpRouterAddress: ADDRESS,
  minTradeSizeUsdc: UINT,
  maxSignatureLifetimeS: z.number().int().nonnegative(),
  tokens: z
    .array(
      z.object({
        address: ADDRESS,
        // Shown to people, so held to a plain shape: letters and digits.
        symbol: z.string().regex(/^[A-Za-z0-9.]{1,16}$/),
        decimals: z.number().int().min(0).max(36),
        class: z.enum(["Regular", "Stable", "Meme"]).nullish(),
      })
    )
    .max(500),
});
const QUOTE = z.object({
  sellAmount: UINT,
  buyAmount: UINT,
  midPrice: z.object({ numerator: UINT, denominator: UINT }),
  spread: z.object({
    ammSpreadHbp: z.number().int().nonnegative(),
    gasHbp: z.number().int().nonnegative(),
  }),
  fee: z.object({
    totalHbp: z.number().int().nonnegative(),
    totalAmount: UINT,
  }),
});
const ERROR_BODY = z.object({ code: z.string() });

// A Turbine API error: toErrorReport recognises it by name and passes only its code on.
class TurbineApiError extends Error {
  readonly code: string;

  constructor(code: string) {
    super("Turbine rejected the request.");
    this.name = "TurbineError";
    this.code = code;
  }
}

function createHttpApi(options: {
  network: NetworkConfig;
  fetch?: Fetch;
}): TurbineApi {
  const fetch = options.fetch ?? globalThis.fetch;
  const { network } = options;

  async function request(
    path: string,
    init: RequestInit,
    unavailable: Partial<Record<number, CliError>> = {}
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`${network.apiUrl}/${path}`, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { accept: "application/json", ...init.headers },
      });
    } catch (error) {
      throw new CliError("NETWORK_UNREACHABLE", {}, { cause: error });
    }
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > MAX_BODY_BYTES) throw new CliError("API_RESPONSE_INVALID");
    let text: string;
    try {
      // The timeout covers the body too; a connection that stalls or drops here is the network's.
      text = await response.text();
    } catch (error) {
      throw new CliError("NETWORK_UNREACHABLE", {}, { cause: error });
    }
    if (Buffer.byteLength(text) > MAX_BODY_BYTES)
      throw new CliError("API_RESPONSE_INVALID");
    if (!response.ok) {
      const known = unavailable[response.status];
      if (known) throw known;
      if ([502, 503, 504].includes(response.status))
        throw new CliError("SERVICE_UNAVAILABLE");
      let code = "UNKNOWN";
      try {
        code = ERROR_BODY.parse(JSON.parse(text)).code;
      } catch {
        // Not Turbine's error shape; the status alone says it failed.
      }
      throw new TurbineApiError(code);
    }
    try {
      return JSON.parse(text) as unknown;
    } catch (error) {
      throw new CliError("API_RESPONSE_INVALID", {}, { cause: error });
    }
  }

  function parse<T>(schema: z.ZodType<T>, body: unknown): T {
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new CliError("API_RESPONSE_INVALID");
    return parsed.data;
  }

  let info: Promise<ProtocolInfo> | undefined;

  return {
    info() {
      info ??= (async () => {
        const config = parse(
          CONFIG,
          await request("config", { method: "GET" })
        );
        const pinned = PINNED[network.name];
        if (
          pinned &&
          (config.turbineSettlerAddress !== pinned.settler ||
            config.lpRouterAddress !== pinned.lpRouter)
        )
          throw new CliError("API_CONTRACTS_UNEXPECTED");
        return {
          version: config.version,
          settler: config.turbineSettlerAddress,
          lpRouter: config.lpRouterAddress,
          minTradeUsdc: config.minTradeSizeUsdc,
          maxSignatureLifetimeS: config.maxSignatureLifetimeS,
          tokens: config.tokens.map((t) => ({
            address: t.address,
            symbol: t.symbol,
            decimals: t.decimals,
            tokenClass: t.class ?? null,
          })),
        };
      })();
      // A failed config isn't kept: the next call asks again.
      info.catch(() => {
        info = undefined;
      });
      return info;
    },

    async quote(sellToken, buyToken, sellAmount): Promise<Quote> {
      const body = await request(
        "quote",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sellToken,
            buyToken,
            sellAmount: sellAmount.toString(),
          }),
        },
        { 501: new CliError("QUOTE_UNAVAILABLE") }
      );
      const quote = parse(QUOTE, body);
      if (quote.midPrice.denominator === 0n)
        throw new CliError("API_RESPONSE_INVALID");
      return {
        sellAmount: quote.sellAmount,
        buyAmount: quote.buyAmount,
        mid: quote.midPrice,
        dexSpreadHbp: quote.spread.ammSpreadHbp,
        gasHbp: quote.spread.gasHbp,
        feeHbp: quote.fee.totalHbp,
        feeAmount: quote.fee.totalAmount,
      };
    },
  };
}

// Turbine's settler: a playground order's Permit2 allowance is valid on Ethereum too, so the
// playground is held to it as well, by a warning rather than a refusal (see order-plan.ts).
const TURBINE_SETTLER = PINNED.mainnet?.settler;

export { createHttpApi, TURBINE_SETTLER, TurbineApiError };
