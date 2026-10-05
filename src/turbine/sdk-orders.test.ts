import {
  custom,
  getAddress,
  encodeAbiParameters,
  keccak256,
  recoverTypedDataAddress,
  stringToBytes,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeApi } from "./fake-api.ts";
import { planOrder } from "./order-plan.ts";
import {
  listOrders,
  openOrderReader,
  submitCancel,
  submitOrder,
  submitOrders,
} from "./sdk-orders.ts";

const API = "https://playground-api.turbine.exchange/api";
const SETTLER = getAddress("0x5964336d54486f70b6a05b7825021427d99a0e16");
const NETWORK = {
  name: "playground" as const,
  apiUrl: API,
  chainId: 1 as const,
};
const ORDER_HASH = `0x${"ab".repeat(32)}` as const;

const CONFIG = {
  version: "0.156.0",
  turbineSettlerAddress: SETTLER,
  turbineSignerAddress: SETTLER,
  lpHookAddress: "0x5858ecf7ba160485037d9432d548556070c9a088",
  lpRouterAddress: "0xe5b67a998b73c5a5817f56c22b433c4642b7262a",
  poolManagerAddress: "0x000000000004444c5dc75cB358380D2e3dE08A90",
  submitSettlements: false,
  siweDomain: "playground-api.turbine.exchange",
  siweUri: API,
  minTradeSizeUsdc: "10000000",
  minLiquidityVolumeUsdc: "10000000",
  eip712Domain: {
    name: "Turbine",
    version: "1",
    chainId: 1,
    verifyingContract: SETTLER,
    salt: keccak256(stringToBytes(API)),
  },
  maxSignatureLifetimeS: 300,
  tokens: [],
};

const ORDERS = {
  orders: [
    {
      hash: ORDER_HASH,
      status: "Active",
      execution: [
        {
          txHash: `0x${"11".repeat(32)}`,
          blockNumber: 16,
          soldAmount: "400000000000000000",
          boughtAmount: "1000000000",
          surplusBuyAmount: "0",
          midPrice: {
            numerator: "2500000000",
            denominator: "1000000000000000000",
          },
        },
      ],
      orderDetails: {
        sellToken: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
        buyToken: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
        sellAmount: "1000000000000000000",
        limitPrice: { numerator: "2400", denominator: "1" },
        startTime: "1800000000",
        endTime: "1800003600",
        spreadCurve: {
          startSecs: 0,
          endSecs: 3600,
          startDeltaBps: 50,
          endDeltaBps: 50,
          points: [],
        },
        createdTimestamp: "2027-01-15T08:00:00",
      },
    },
  ],
  cursor: null,
  hasMore: false,
};

type Sent = { url: string; body: unknown };
let sent: Sent[] = [];

// Turbine's API for the SDK: status, config, and the signed endpoints.
function stubApi() {
  sent = [];
  vi.stubGlobal(
    "fetch",
    (input: string | URL | Request, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const body =
        typeof init?.body === "string"
          ? (JSON.parse(init.body) as unknown)
          : undefined;
      if (init?.method === "POST") sent.push({ url, body });
      const reply = (value: unknown) =>
        Promise.resolve(new Response(JSON.stringify(value), { status: 200 }));
      if (url.endsWith("/status")) return Promise.resolve(new Response("OK"));
      if (url.endsWith("/config")) return reply(CONFIG);
      if (url.endsWith("/eip712/add_order"))
        return reply({ orderHash: ORDER_HASH });
      if (url.endsWith("/eip712/cancel_order"))
        return reply({ orderHash: ORDER_HASH });
      if (url.endsWith("/eip712/orders")) return reply(ORDERS);
      if (url.endsWith("/eip712/add_orders"))
        return reply([{ orderHash: ORDER_HASH }, { orderHash: ORDER_HASH }]);
      return Promise.resolve(new Response("{}", { status: 404 }));
    }
  );
}

// Ethereum for the SDK: chain id, and Permit2's allowance (amount, expiration, nonce 7).
const transport = custom({
  request({ method }: { method: string }) {
    if (method === "eth_chainId") return Promise.resolve("0x1");
    if (method === "eth_getBlockByNumber")
      return Promise.resolve({
        number: "0x10",
        hash: `0x${"22".repeat(32)}`,
        parentHash: `0x${"33".repeat(32)}`,
        timestamp: "0x6b49d200",
        transactions: [],
      });
    if (method === "eth_call")
      return Promise.resolve(
        encodeAbiParameters(
          [{ type: "uint160" }, { type: "uint48" }, { type: "uint48" }],
          [0n, 0, 7]
        )
      );
    return Promise.reject(new Error(`unexpected ${method}`));
  },
});

async function plan(owner: `0x${string}`) {
  return planOrder(
    {
      amount: "1",
      sell: "WETH",
      buy: "USDC",
      spreadBps: 50,
      ttl: "1h",
      limit: "2400",
    },
    {
      api: createFakeApi(),
      chain: {
        balance: () => Promise.resolve(10n ** 30n),
        allowance: () => Promise.resolve(2n ** 256n - 1n),
      },
      owner,
      network: "playground",
      now: () => 1_800_000_000,
    }
  );
}

beforeEach(stubApi);
afterEach(() => vi.unstubAllGlobals());

describe("a dry run through the real SDK", () => {
  it("captures the Permit2 allowance and the order exactly as the SDK builds them, and sends nothing", async () => {
    const owner = privateKeyToAccount(generatePrivateKey()).address;
    const p = await plan(owner);
    const result = await submitOrder(
      p,
      { kind: "dry-run", address: owner },
      { network: NETWORK, transport }
    );
    expect(result.kind).toBe("dry-run");
    if (result.kind !== "dry-run") return;
    expect(sent).toEqual([]);
    expect(result.sign.map((s) => s.purpose)).toEqual([
      "permit2-allowance",
      "order",
    ]);
    const [permit, order] = result.sign.map((s) => s.typedData) as Array<{
      primaryType: string;
      domain: Record<string, unknown>;
      message: Record<string, unknown>;
    }>;
    expect(permit?.primaryType).toBe("PermitSingle");
    expect(permit?.domain.verifyingContract).toBe(
      "0x000000000022D473030F116dDEE9F6B43aC78BA3"
    );
    expect(permit?.message).toMatchObject({
      spender: SETTLER,
      details: {
        token: p.sell.address,
        // Unlimited (uint160 max) until the order ends: the summary has to say so.
        amount: (2n ** 160n - 1n).toString(),
        expiration: Number(p.endTime),
        nonce: 7,
      },
    });
    expect(order?.primaryType).toBe("AddOrder");
    expect(order?.domain.verifyingContract).toBe(SETTLER);
    expect(order?.message).toMatchObject({
      order: {
        owner,
        sellToken: p.sell.address,
        buyToken: p.buy.address,
        sellAmount: p.sellAmount.toString(),
        minBuyAmount: p.minBuyAmount.toString(),
        startDeltaBps: 50,
        endDeltaBps: 50,
        partialFill: true,
      },
    });
  });
});

describe("placing for real through the SDK", () => {
  it("signs both, sends the order once, and returns its hash", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const p = await plan(account.address);
    const result = await submitOrder(
      p,
      { kind: "account", account },
      { network: NETWORK, transport }
    );
    expect(result).toEqual({ kind: "sent", hash: ORDER_HASH });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe(`${API}/eip712/add_order`);
    const envelope = sent[0]?.body as {
      auth: { signer: string; signature: unknown };
      payload: { signedPermit: unknown };
    };
    expect(envelope.auth.signer.toLowerCase()).toBe(
      account.address.toLowerCase()
    );
    expect(envelope.payload.signedPermit).toBeDefined();
  });

  it("refuses an SDK config naming a different settler than the one checked", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const p = {
      ...(await plan(account.address)),
      settler: "0x000000000000000000000000000000000000dEaD" as const,
    };
    await expect(
      submitOrder(
        p,
        { kind: "account", account },
        { network: NETWORK, transport }
      )
    ).rejects.toMatchObject({ code: "API_CONTRACTS_UNEXPECTED" });
    expect(sent).toEqual([]);
  });
});

describe("after the order was sent", () => {
  it("never calls a failure retryable: the order may already be placed", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const p = await plan(account.address);
    vi.stubGlobal(
      "fetch",
      (input: string | URL | Request, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        if (url.endsWith("/status")) return Promise.resolve(new Response("OK"));
        if (url.endsWith("/config"))
          return Promise.resolve(new Response(JSON.stringify(CONFIG)));
        if (init?.method === "POST")
          return Promise.resolve(new Response("not json", { status: 200 }));
        return Promise.resolve(new Response("{}", { status: 404 }));
      }
    );
    const error = await submitOrder(
      p,
      { kind: "account", account },
      { network: NETWORK, transport }
    ).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "ORDER_OUTCOME_UNKNOWN" });
  });
});

describe("listing orders", () => {
  it("signs a query for the wallet's orders and reads fills with their block time", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const orders = await listOrders(
      account,
      SETTLER,
      { statuses: ["Active"], limit: 20 },
      { network: NETWORK, transport }
    );
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      hash: ORDER_HASH,
      status: "Active",
      executedSellAmount: 400000000000000000n,
    });
    expect(orders[0]?.execution[0]?.clearedAt).toBeInstanceOf(Date);
    const query = sent.find((s) => s.url.endsWith("/eip712/orders"))?.body as {
      payload: { statuses: string[]; limit: number };
    };
    expect(query.payload).toMatchObject({ statuses: ["Active"], limit: 20 });
  });
});

describe("a ladder through the real SDK", () => {
  it("dry-runs each level's two signatures and sends nothing", async () => {
    const owner = privateKeyToAccount(generatePrivateKey()).address;
    const p = await plan(owner);
    const result = await submitOrders(
      [p, p],
      { kind: "dry-run", address: owner },
      { network: NETWORK, transport }
    );
    expect(result.kind).toBe("dry-run");
    if (result.kind === "dry-run")
      expect(result.sign.map((level) => level.map((s) => s.purpose))).toEqual([
        ["permit2-allowance", "order"],
        ["permit2-allowance", "order"],
      ]);
    expect(sent).toEqual([]);
  });

  it("sends every level in one signed batch and returns their hashes", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const p = await plan(account.address);
    const result = await submitOrders(
      [p, p],
      { kind: "account", account },
      { network: NETWORK, transport }
    );
    expect(result).toEqual({ kind: "sent", hashes: [ORDER_HASH, ORDER_HASH] });
    expect(sent.map((s) => s.url)).toEqual([`${API}/eip712/add_orders`]);
    expect(sent[0]?.body).toHaveLength(2);
  });
});

describe("a batch Turbine only partly confirms", () => {
  it("reads as an unknown outcome, never as success", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const p = await plan(account.address);
    const result = await submitOrders(
      [p, p, p],
      { kind: "account", account },
      { network: NETWORK, transport }
    ).catch((e: unknown) => e);
    expect(result).toMatchObject({ code: "ORDER_OUTCOME_UNKNOWN" });
  });
});

describe("reading orders again and again", () => {
  it("connects once, so the SDK's caches keep working between polls", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    let configs = 0;
    const counting = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      (input: string | URL | Request, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        if (url.endsWith("/config")) configs++;
        return counting(input, init);
      }
    );
    const reader = openOrderReader(account, SETTLER, {
      network: NETWORK,
      transport,
    });
    await reader.list({ hashes: [ORDER_HASH] });
    await reader.list({ hashes: [ORDER_HASH] });
    expect(configs).toBe(1);
  });
});

describe("cancelling", () => {
  it("dry-runs the cancel signature without sending it", async () => {
    const owner = privateKeyToAccount(generatePrivateKey()).address;
    const result = await submitCancel(
      ORDER_HASH,
      SETTLER,
      { kind: "dry-run", address: owner },
      { network: NETWORK, transport }
    );
    expect(result.kind).toBe("dry-run");
    if (result.kind === "dry-run") {
      expect(result.sign.map((s) => s.purpose)).toEqual(["cancel"]);
      expect(result.sign[0]?.typedData).toMatchObject({
        message: { orderHash: ORDER_HASH },
      });
    }
    expect(sent).toEqual([]);
  });

  it("signs and sends a real cancel that recovers to the wallet", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const result = await submitCancel(
      ORDER_HASH,
      SETTLER,
      { kind: "account", account },
      { network: NETWORK, transport }
    );
    expect(result).toEqual({ kind: "sent", hash: ORDER_HASH });
    expect(sent[0]?.url).toBe(`${API}/eip712/cancel_order`);
    expect(typeof recoverTypedDataAddress).toBe("function");
  });
});
