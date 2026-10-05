// What turbine-cli reads from and writes to Ethereum itself: a token's balance and its allowance to
// Permit2 (orders can't settle without it), and the approve transaction that sets that allowance.
import { encodeFunctionData, erc20Abi, maxUint256 } from "viem";

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
    args: readonly Hex[];
  }): Promise<unknown>;
};
type ApproveCall = { to: Hex; spender: Hex; amount: bigint; data: Hex };

// Uniswap's Permit2, the same address on every chain; Turbine's orders spend through it.
const PERMIT2: Hex = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

function createChainReader(client: ContractReader): ChainReader {
  const read = async (
    token: Hex,
    functionName: "balanceOf" | "allowance",
    args: readonly Hex[]
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

export { PERMIT2, approveCall, createChainReader };
export type { ApproveCall, ChainReader, ContractReader };
