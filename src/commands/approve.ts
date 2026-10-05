// turbine approve: the one-time ERC-20 approval that lets Permit2 move a token, so Turbine's orders
// can settle. It is an Ethereum transaction (gas, real funds) whatever --network says, so it always
// asks first, and --dry-run shows the exact transaction instead.
import { CliError } from "../output/errors.ts";
import type { Theme } from "../output/theme.ts";
import { formatAmount, parseAmount } from "../turbine/amounts.ts";
import type { TurbineApi } from "../turbine/api.ts";
import { approveCall, PERMIT2 } from "../turbine/chain.ts";
import type {
  ApproveCall,
  ChainReader,
  ChainWriter,
} from "../turbine/chain.ts";
import { resolveToken } from "../turbine/tokens.ts";
import type { Hex, Unlocked } from "../wallet/signer.ts";

type Tx = { chainId: 1; to: Hex; data: Hex; spender: Hex; amount: string };
type ApproveResult =
  | { status: "already-approved"; token: string; allowance: string }
  | { status: "dry-run"; token: string; transactions: Tx[] }
  | { status: "approved"; token: string; transactions: Hex[] };
type ApproveDeps = {
  api: TurbineApi;
  reader: ChainReader;
  writer: ChainWriter;
  wallet: { name: string; address: Hex };
  dryRun: boolean;
  yes: boolean;
  interactive: boolean;
  confirm: (message: string) => Promise<boolean | undefined>;
  unlock: () => Promise<Unlocked>;
};

const UNLIMITED = 2n ** 256n - 1n;

function tx(call: ApproveCall): Tx {
  return {
    chainId: 1,
    to: call.to,
    data: call.data,
    spender: call.spender,
    amount: call.amount === UNLIMITED ? "unlimited" : call.amount.toString(),
  };
}

async function approveCommand(
  input: { token: string; amount?: string },
  deps: ApproveDeps
): Promise<ApproveResult> {
  const { tokens } = await deps.api.info();
  const token = resolveToken(input.token, tokens);
  const wanted =
    input.amount === undefined
      ? UNLIMITED
      : parseAmount(input.amount, token.decimals);
  const current = await deps.reader.allowance(
    token.address,
    deps.wallet.address
  );
  if (current >= wanted)
    return {
      status: "already-approved",
      token: token.symbol,
      allowance:
        current === UNLIMITED
          ? "unlimited"
          : formatAmount(current, token.decimals),
    };

  // USDT refuses to change an allowance that isn't zero: it has to be reset first.
  const calls =
    token.symbol.toUpperCase() === "USDT" && current > 0n
      ? [approveCall(token.address, 0n), approveCall(token.address, wanted)]
      : [approveCall(token.address, wanted)];
  if (deps.dryRun)
    return {
      status: "dry-run",
      token: token.symbol,
      transactions: calls.map(tx),
    };

  if (deps.interactive) {
    const sure = await deps.confirm(
      `Send ${calls.length === 1 ? "an Ethereum transaction" : "two Ethereum transactions"} approving Permit2 for ${token.symbol}? It costs gas in ETH.`
    );
    if (sure !== true) throw new CliError("CANCELLED");
  } else if (!deps.yes) {
    throw new CliError("CONFIRMATION_REQUIRED");
  }

  const { account } = await deps.unlock();
  if (account.address.toLowerCase() !== deps.wallet.address.toLowerCase())
    throw new CliError("WALLET_ADDRESS_MISMATCH");
  const hashes: Hex[] = [];
  for (const call of calls) hashes.push(await deps.writer.send(call, account));
  return { status: "approved", token: token.symbol, transactions: hashes };
}

function renderApprove(result: ApproveResult, theme: Theme): string {
  switch (result.status) {
    case "already-approved":
      return `${theme.success("✓")} Permit2 can already move your ${result.token} (${result.allowance}). Nothing to do.`;
    case "dry-run":
      return [
        theme.dim(
          "Dry run: nothing was signed or sent. Would send on Ethereum:"
        ),
        ...result.transactions.map(
          (t, i) =>
            `  ${theme.dim(`${i + 1}.`)} approve ${t.amount} ${result.token} for Permit2 ${PERMIT2} (to ${t.to})`
        ),
      ].join("\n");
    case "approved":
      return [
        `${theme.success("✓")} Permit2 can now move your ${result.token}.`,
        ...result.transactions.map((hash) =>
          theme.dim(`  transaction ${hash}`)
        ),
      ].join("\n");
  }
}

export { approveCommand, renderApprove };
export type { ApproveResult };
