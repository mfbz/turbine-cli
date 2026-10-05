// What turbine-cli reads from and writes to Ethereum itself: a token's balance and its allowance to
// Permit2 (orders can't settle without it), and the approve transaction that sets that allowance.
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  http,
  maxUint256,
} from "viem";
import type { Account, Transport } from "viem";
import { mainnet } from "viem/chains";

import { CliError } from "../output/errors.ts";
import type { Hex } from "../wallet/signer.ts";

type ChainReader = {
  balance(token: Hex, owner: Hex): Promise<bigint>;
  allowance(token: Hex, owner: Hex): Promise<bigint>;
};
// The one viem method this needs, so tests can stand in for an RPC.
type ContractReader = {
  readContract(args: {
    address: Hex;
    abi: typeof erc20Abi;
    functionName: "balanceOf" | "allowance";
    args: readonly [Hex] | readonly [Hex, Hex];
  }): Promise<unknown>;
};
type ApproveCall = { to: Hex; spender: Hex; amount: bigint; data: Hex };
type ChainWriter = {
  /** Sends the transaction and waits for it to be mined; returns its hash. */
  send(call: ApproveCall, account: Account): Promise<Hex>;
};
type Chain = { reader: ChainReader; writer: ChainWriter };

// How long to wait for an approval to be mined before giving its hash back to check later.
const RECEIPT_TIMEOUT_MS = 180_000;

// Uniswap's Permit2, the same address on every chain; Turbine's orders spend through it.
const PERMIT2: Hex = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

function createChainReader(client: ContractReader): ChainReader {
  const read = async (
    token: Hex,
    functionName: "balanceOf" | "allowance",
    args: readonly [Hex] | readonly [Hex, Hex]
  ): Promise<bigint> => {
    try {
      const value = await client.readContract({
        address: token,
        abi: erc20Abi,
        functionName,
        args,
      });
      if (typeof value !== "bigint") throw new Error("not a number");
      return value;
    } catch (error) {
      // RPC errors quote the endpoint URL, which can carry an API key: never pass their text on.
      throw new CliError("RPC_UNREACHABLE", {}, { cause: error });
    }
  };
  return {
    balance: (token, owner) => read(token, "balanceOf", [owner]),
    allowance: (token, owner) => read(token, "allowance", [owner, PERMIT2]),
  };
}

/** The ERC-20 approve that lets Permit2 move this token: unlimited unless an amount is given. */
function approveCall(token: Hex, amount: bigint = maxUint256): ApproveCall {
  return {
    to: token,
    spender: PERMIT2,
    amount,
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [PERMIT2, amount],
    }),
  };
}

// viem's error names for a sender without enough ETH for gas.
function noGas(error: unknown): boolean {
  let current: unknown = error;
  while (current instanceof Error) {
    if (current.name === "InsufficientFundsError") return true;
    current = current.cause;
  }
  return false;
}

/** Ethereum mainnet over TURBINE_RPC_URL or viem's public endpoint. Both networks settle there. */
function createChain(options: {
  rpcUrl?: string;
  transport?: Transport;
}): Chain {
  const transport = options.transport ?? http(options.rpcUrl);
  const publicClient = createPublicClient({ chain: mainnet, transport });
  return {
    // viem's readContract is generic over the ABI; the reader only ever asks for these two calls.
    reader: createChainReader({
      readContract: ({
        address,
        functionName,
        args: [owner, spender = PERMIT2],
      }) =>
        functionName === "balanceOf"
          ? publicClient.readContract({
              address,
              abi: erc20Abi,
              functionName,
              args: [owner],
            })
          : publicClient.readContract({
              address,
              abi: erc20Abi,
              functionName,
              args: [owner, spender],
            }),
    }),
    writer: {
      async send(call, account) {
        const wallet = createWalletClient({
          account,
          chain: mainnet,
          transport,
        });
        let hash: Hex;
        try {
          hash = await wallet.sendTransaction({ to: call.to, data: call.data });
        } catch (error) {
          throw new CliError(
            noGas(error) ? "ETH_TOO_LOW" : "RPC_UNREACHABLE",
            {},
            { cause: error }
          );
        }
        try {
          const receipt = await publicClient.waitForTransactionReceipt({
            hash,
            timeout: RECEIPT_TIMEOUT_MS,
          });
          if (receipt.status !== "success")
            throw new CliError("TRANSACTION_REVERTED", { hash });
        } catch (error) {
          if (error instanceof CliError) throw error;
          throw new CliError("TRANSACTION_PENDING", { hash }, { cause: error });
        }
        return hash;
      },
    },
  };
}

export { PERMIT2, approveCall, createChain, createChainReader };
export type { ApproveCall, Chain, ChainReader, ChainWriter, ContractReader };
