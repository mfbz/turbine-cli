// A local stand-in for Turbine's playground, for demos and development when the real one is out of
// reach. It serves Turbine's API (config, quote, and the signed order endpoints the SDK uses) and the
// few Ethereum RPC calls turbine-cli makes, all from memory on 127.0.0.1. Orders fill in steps over
// about 20 seconds; an order better than mid (a negative spread) waits, so there is one to cancel; a
// cancel takes effect after a 12-second Speedbump, as on Turbine. Signatures are not verified: this is
// a demo, not a model of Turbine's checks. Run with `npm run mock`; it is never part of the package.
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";

import {
  encodeAbiParameters,
  getAddress,
  keccak256,
  maxUint256,
  stringToBytes,
  toHex,
} from "viem";

type Hex = `0x${string}`;
type MockOptions = { port: number; now?: () => number };
type MockTurbine = {
  apiUrl: string;
  rpcUrl: string;
  settler: Hex;
  close: () => Promise<void>;
};
type Token = { address: Hex; symbol: string; decimals: number; class: string };
type Order = {
  hash: Hex;
  owner: string;
  order: Record<string, unknown> & {
    sellToken: Hex;
    buyToken: Hex;
    sellAmount: string;
    minBuyAmount: string;
    startTime: string;
    endTime: string;
  };
  spreadCurve: { startDeltaBps?: number; endDeltaBps?: number };
  createdMs: number;
  cancelledMs: number | null;
};
type Envelope = { payload?: unknown; auth?: { signer?: string } };

// Turbine's current mainnet settler, so the demo shows the same address a real order would.
const SETTLER = getAddress("0x5964336d54486f70b6a05b7825021427d99a0e16");
const TOKENS: Token[] = [
  {
    address: getAddress("0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"),
    symbol: "WETH",
    decimals: 18,
    class: "Regular",
  },
  {
    address: getAddress("0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"),
    symbol: "USDC",
    decimals: 6,
    class: "Stable",
  },
  {
    address: getAddress("0x2260fac5e5542a773aa44fbcfedf7c193bc2c599"),
    symbol: "WBTC",
    decimals: 8,
    class: "Regular",
  },
];
// USD per whole token; the mid drifts around these by up to 0.2%, so a live view has something to show.
const USD: Readonly<Record<string, number>> = {
  WETH: 2500,
  USDC: 1,
  WBTC: 60_000,
};
const DRIFT = 0.002;
const DRIFT_PERIOD_MS = 40_000;
const FEE_HBP = 700n;
// Fills: three steps, the first after 6 s; shares in percent.
const FILL_EVERY_MS = 6_000;
const FILL_SHARES = [30n, 40n, 30n];
const SPEEDBUMP_MS = 12_000;
const MAX_BODY = 1024 * 1024;
const DEFAULT_PORT = 4646;
const SELECTOR = {
  balanceOf: "0x70a08231",
  allowance: "0xdd62ed3e",
} as const;

function token(address: string): Token | undefined {
  return TOKENS.find((t) => t.address.toLowerCase() === address.toLowerCase());
}

function usd(symbol: string, ms: number): number {
  const base = USD[symbol] ?? 1;
  if (symbol === "USDC") return base;
  return base * (1 + DRIFT * Math.sin((2 * Math.PI * ms) / DRIFT_PERIOD_MS));
}

// The mid price in atomic units, buy per sell, as Turbine gives it.
function mid(sell: Token, buy: Token, ms: number) {
  return {
    numerator:
      BigInt(Math.round(usd(sell.symbol, ms) * 1e6)) *
      10n ** BigInt(buy.decimals),
    denominator:
      BigInt(Math.round(usd(buy.symbol, ms) * 1e6)) *
      10n ** BigInt(sell.decimals),
  };
}

// Every step that would happen: before the order ends, and never below its limit (a step whose price
// is below the floor simply doesn't trade, as on Turbine).
function fills(order: Order) {
  const bps = Number(order.spreadCurve.startDeltaBps ?? 0);
  // Better than mid: no taker comes at today's prices.
  if (bps < 0) return [];
  const sell = token(order.order.sellToken);
  const buy = token(order.order.buyToken);
  if (!sell || !buy) return [];
  const total = BigInt(order.order.sellAmount);
  const floor = BigInt(order.order.minBuyAmount);
  const endMs = Number(order.order.endTime) * 1000;
  let left = total;
  return FILL_SHARES.map((share, i) => {
    const sold = i === FILL_SHARES.length - 1 ? left : (total * share) / 100n;
    left -= sold;
    const at = order.createdMs + FILL_EVERY_MS * (i + 1);
    const price = mid(sell, buy, at);
    const bought =
      (sold * price.numerator * BigInt(10_000 - bps)) /
      (price.denominator * 10_000n);
    return {
      at,
      trades: at < endMs && bought * total >= floor * sold,
      txHash: keccak256(stringToBytes(`${order.hash}:${i}`)),
      // The block number is the fill's second, so a block's timestamp is its number.
      blockNumber: Math.floor(at / 1000),
      soldAmount: sold.toString(),
      boughtAmount: bought.toString(),
      surplusBuyAmount: "0",
      midPrice: {
        numerator: price.numerator.toString(),
        denominator: price.denominator.toString(),
      },
    };
  });
}

function state(order: Order, now: number) {
  const cutoff = Math.min(now, order.cancelledMs ?? now);
  const all = fills(order);
  const done = all.filter((f) => f.trades && f.at <= cutoff);
  const filled = all.length > 0 && done.length === all.length;
  const status = filled
    ? "Filled"
    : order.cancelledMs !== null
      ? now < order.cancelledMs + SPEEDBUMP_MS
        ? "PendingCancellation"
        : "Canceled"
      : now >= Number(order.order.endTime) * 1000
        ? "Expired"
        : "Active";
  return {
    hash: order.hash,
    status,
    execution: done.map((f) => ({
      txHash: f.txHash,
      blockNumber: f.blockNumber,
      soldAmount: f.soldAmount,
      boughtAmount: f.boughtAmount,
      surplusBuyAmount: f.surplusBuyAmount,
      midPrice: f.midPrice,
    })),
    orderDetails: {
      sellToken: order.order.sellToken,
      buyToken: order.order.buyToken,
      sellAmount: order.order.sellAmount,
      limitPrice: {
        numerator: order.order.minBuyAmount,
        denominator: order.order.sellAmount,
      },
      startTime: order.order.startTime,
      endTime: order.order.endTime,
      // Sent as a window (0–10,000 of the order's life); read back in seconds.
      spreadCurve: {
        startSecs: 0,
        endSecs: Number(order.order.endTime) - Number(order.order.startTime),
        startDeltaBps: Number(order.spreadCurve.startDeltaBps ?? 0),
        endDeltaBps: Number(order.spreadCurve.endDeltaBps ?? 0),
        points: [],
      },
      // Turbine sends UTC without the zone.
      createdTimestamp: new Date(order.createdMs).toISOString().slice(0, -1),
    },
  };
}

function config(apiUrl: string) {
  return {
    version: "mock",
    turbineSettlerAddress: SETTLER,
    turbineSignerAddress: SETTLER,
    lpHookAddress: SETTLER,
    lpRouterAddress: getAddress("0xe5b67a998b73c5a5817f56c22b433c4642b7262a"),
    poolManagerAddress: getAddress(
      "0x000000000004444c5dc75cb358380d2e3de08a90"
    ),
    submitSettlements: false,
    siweDomain: "127.0.0.1",
    siweUri: apiUrl,
    minTradeSizeUsdc: "10000000",
    minLiquidityVolumeUsdc: "10000000",
    eip712Domain: {
      name: "Turbine",
      version: "1",
      chainId: 1,
      verifyingContract: SETTLER,
      salt: keccak256(stringToBytes(apiUrl)),
    },
    maxSignatureLifetimeS: 300,
    tokens: TOKENS,
  };
}

function quote(body: Record<string, unknown>, now: number) {
  const sell = token(String(body.sellToken));
  const buy = token(String(body.buyToken));
  if (!sell || !buy)
    return { status: 400, body: { code: "TOKEN_NOT_SUPPORTED" } };
  if (
    !UINT.test(String(body.sellAmount)) ||
    BigInt(String(body.sellAmount)) === 0n
  )
    return { status: 400, body: { code: "INVALID_AMOUNT" } };
  const sellAmount = BigInt(String(body.sellAmount));
  const price = mid(sell, buy, now);
  const atMid = (sellAmount * price.numerator) / price.denominator;
  const fee = (atMid * FEE_HBP) / 1_000_000n;
  return {
    status: 200,
    body: {
      sellAmount: sellAmount.toString(),
      buyAmount: (atMid - fee).toString(),
      midPrice: {
        numerator: price.numerator.toString(),
        denominator: price.denominator.toString(),
      },
      spread: { ammSpreadHbp: 1500, gasHbp: 300 },
      fee: { totalHbp: Number(FEE_HBP), totalAmount: fee.toString() },
    },
  };
}

function rpc(method: string, params: unknown[], now: number): unknown {
  const seconds = Math.floor(now / 1000);
  switch (method) {
    case "eth_chainId":
      return "0x1";
    case "eth_blockNumber":
      return toHex(seconds);
    case "eth_getBalance":
      return "0x0";
    case "eth_getBlockByNumber": {
      const tag = String(params[0]);
      const number = tag.startsWith("0x") ? Number(tag) : seconds;
      return {
        number: toHex(number),
        hash: keccak256(stringToBytes(`block:${number}`)),
        parentHash: keccak256(stringToBytes(`block:${number - 1}`)),
        timestamp: toHex(number),
        transactions: [],
      };
    }
    case "eth_call": {
      const data = String((params[0] as { data?: string } | undefined)?.data);
      const word = (value: bigint) =>
        encodeAbiParameters([{ type: "uint256" }], [value]);
      // A fresh demo wallet: no tokens, and Permit2 already approved.
      if (data.startsWith(SELECTOR.balanceOf)) return word(0n);
      if (data.startsWith(SELECTOR.allowance)) return word(maxUint256);
      // Permit2's own allowance (amount, expiration, nonce): never used.
      return encodeAbiParameters(
        [{ type: "uint160" }, { type: "uint48" }, { type: "uint48" }],
        [0n, 0, 0]
      );
    }
    default:
      throw new Error(`method not supported: ${method}`);
  }
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
// The SDK sends bigints as hex strings ("0x…"); decimal strings are accepted too.
const UINT = /^(?:\d{1,78}|0x[0-9a-fA-F]{1,64})$/;

// Only what a stored order needs, so one bad request can't break a wallet's list later.
function valid(payload: unknown): Pick<Order, "order" | "spreadCurve"> {
  const p = payload as Partial<Pick<Order, "order" | "spreadCurve">> | null;
  const o = p?.order;
  const ok =
    typeof o === "object" &&
    o !== null &&
    ADDRESS.test(String(o.sellToken)) &&
    ADDRESS.test(String(o.buyToken)) &&
    [o.sellAmount, o.minBuyAmount, o.startTime, o.endTime].every((v) =>
      UINT.test(String(v))
    ) &&
    BigInt(o.sellAmount) > 0n &&
    typeof p?.spreadCurve === "object" &&
    p.spreadCurve !== null;
  if (!ok || !o || !p.spreadCurve) throw new Error("invalid order");
  return { order: o, spreadCurve: p.spreadCurve };
}

function readBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      try {
        resolve(text ? (JSON.parse(text) as unknown) : undefined);
      } catch (error) {
        reject(new Error("invalid JSON", { cause: error }));
      }
    });
    request.on("error", reject);
  });
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function startMockTurbine(options: MockOptions): Promise<MockTurbine> {
  const now = options.now ?? Date.now;
  const orders = new Map<Hex, Order>();
  let apiUrl = "";

  const add = (envelope: Envelope): Hex => {
    const payload = valid(envelope.payload);
    const owner = String(envelope.auth?.signer ?? "").toLowerCase();
    const hash = keccak256(
      stringToBytes(`${JSON.stringify(payload)}:${orders.size}:${now()}`)
    );
    orders.set(hash, {
      hash,
      owner,
      order: payload.order,
      spreadCurve: payload.spreadCurve,
      createdMs: now(),
      cancelledMs: null,
    });
    return hash;
  };

  const api = (path: string, body: unknown) => {
    const envelope = (body ?? {}) as Envelope;
    const signer = String(envelope.auth?.signer ?? "").toLowerCase();
    switch (path) {
      case "/api/status":
        return { status: 200, body: "OK" };
      case "/api/config":
        return { status: 200, body: config(apiUrl) };
      case "/api/quote":
        return quote((body ?? {}) as Record<string, unknown>, now());
      case "/api/eip712/add_order":
        return { status: 200, body: { orderHash: add(envelope) } };
      case "/api/eip712/add_orders":
        return {
          status: 200,
          body: (Array.isArray(body) ? (body as Envelope[]) : [])
            .map((e) => ({ ...e, payload: valid(e.payload) }))
            .map((e) => ({ orderHash: add(e) })),
        };
      case "/api/eip712/cancel_order": {
        const hash = (envelope.payload as { orderHash?: Hex }).orderHash;
        const order = hash ? orders.get(hash) : undefined;
        if (!order || order.owner !== signer)
          return { status: 404, body: { code: "ORDER_NOT_FOUND" } };
        if (
          !["Active", "PendingCancellation"].includes(
            state(order, now()).status
          )
        )
          return { status: 400, body: { code: "ORDER_NOT_CANCELLABLE" } };
        order.cancelledMs ??= now();
        return { status: 200, body: { orderHash: order.hash } };
      }
      case "/api/eip712/orders": {
        const query = envelope.payload as {
          hashes?: string[];
          statuses?: string[];
          limit?: number;
        };
        const list = [...orders.values()]
          .filter((o) => o.owner === signer)
          .filter((o) => !query.hashes?.length || query.hashes.includes(o.hash))
          .sort((a, b) => b.createdMs - a.createdMs)
          .map((o) => state(o, now()))
          .filter(
            (o) => !query.statuses?.length || query.statuses.includes(o.status)
          )
          .slice(0, query.limit || 100);
        return {
          status: 200,
          body: { orders: list, cursor: null, hasMore: false },
        };
      }
      default:
        return { status: 404, body: { code: "NOT_FOUND" } };
    }
  };

  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    readBody(request)
      .then((body) => {
        if (path === "/rpc") {
          const call = body as {
            id?: number;
            method: string;
            params?: unknown[];
          };
          try {
            const result = rpc(call.method, call.params ?? [], now());
            send(response, 200, { jsonrpc: "2.0", id: call.id, result });
          } catch {
            send(response, 200, {
              jsonrpc: "2.0",
              id: call.id,
              error: { code: -32601, message: "method not supported" },
            });
          }
          return;
        }
        const reply = api(path.replace(/\/+$/, ""), body);
        send(response, reply.status, reply.body);
      })
      .catch(() => send(response, 400, { code: "BAD_REQUEST" }));
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      apiUrl = `http://127.0.0.1:${port}/api`;
      resolve({
        apiUrl,
        rpcUrl: `http://127.0.0.1:${port}/rpc`,
        settler: SETTLER,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.MOCK_TURBINE_PORT ?? DEFAULT_PORT);
  const mock = await startMockTurbine({ port }).catch((error: unknown) => {
    const busy = (error as NodeJS.ErrnoException).code === "EADDRINUSE";
    console.error(
      busy
        ? `Port ${port} is in use. Choose another: MOCK_TURBINE_PORT=4747 npm run mock`
        : "The mock couldn't start."
    );
    process.exit(1);
  });
  console.log(`A local mock of Turbine's playground is running on 127.0.0.1:${port}.

In another terminal:

  export TURBINE_API_URL=${mock.apiUrl}
  export TURBINE_RPC_URL=${mock.rpcUrl}
  turbine

Orders fill in about 20 s; a negative spread waits, so you can cancel it. Ctrl-C stops the mock.`);
}

export { startMockTurbine };
export type { MockTurbine };
