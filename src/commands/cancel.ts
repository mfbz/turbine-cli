// turbine order cancel: a signed cancel request. Turbine delays it by the Speedbump (about 12 s), so
// the order reads "cancelling" first. --dry-run shows the exact request; mainnet asks first.
import type { NetworkConfig } from "../config/network.ts";
import { CliError } from "../output/errors.ts";
import type { Theme } from "../output/theme.ts";
import type {
  SdkDeps,
  SignRequest,
  Signer,
  Submitted,
} from "../turbine/sdk-orders.ts";
import type { Hex, Unlocked } from "../wallet/signer.ts";

type CancelResult =
  | { dryRun: true; hash: Hex; sign: SignRequest[] }
  | { dryRun: false; hash: Hex; status: "cancelling" };
type CancelDeps = {
  network: NetworkConfig;
  wallet: { address: Hex };
  settler: () => Promise<Hex>;
  dryRun: boolean;
  yes: boolean;
  interactive: boolean;
  confirm: (message: string) => Promise<boolean | undefined>;
  unlock: () => Promise<Unlocked>;
  submit: (
    hash: Hex,
    settler: Hex,
    signer: Signer,
    deps: SdkDeps
  ) => Promise<Submitted>;
};

const HASH = /^0x[0-9a-fA-F]{64}$/;

function checkHash(text: string): Hex {
  if (!HASH.test(text)) throw new CliError("HASH_INVALID");
  return text as Hex;
}

async function cancelCommand(
  input: string,
  deps: CancelDeps
): Promise<CancelResult> {
  const hash = checkHash(input);
  const settler = await deps.settler();
  const sdk: SdkDeps = { network: deps.network };
  if (deps.dryRun) {
    const result = await deps.submit(
      hash,
      settler,
      { kind: "dry-run", address: deps.wallet.address },
      sdk
    );
    if (result.kind !== "dry-run") throw new CliError("INTERNAL");
    return { dryRun: true, hash, sign: result.sign };
  }
  if (deps.network.name === "mainnet") {
    if (deps.interactive) {
      if ((await deps.confirm(`Cancel order ${hash} on mainnet?`)) !== true)
        throw new CliError("CANCELLED");
    } else if (!deps.yes) {
      throw new CliError("CONFIRMATION_REQUIRED");
    }
  }
  const { account } = await deps.unlock();
  if (account.address.toLowerCase() !== deps.wallet.address.toLowerCase())
    throw new CliError("WALLET_ADDRESS_MISMATCH");
  const result = await deps.submit(
    hash,
    settler,
    { kind: "account", account },
    sdk
  );
  if (result.kind !== "sent") throw new CliError("INTERNAL");
  return { dryRun: false, hash, status: "cancelling" };
}

function renderCancel(result: CancelResult, theme: Theme): string {
  if (result.dryRun)
    return theme.dim(
      `Dry run: nothing was signed or sent. Would sign a cancel for ${result.hash} (--json shows the typed data).`
    );
  return [
    `${theme.success("✓")} Cancel sent for ${result.hash}.`,
    theme.dim(
      "Turbine applies it after the Speedbump (about 12 s); until then it reads cancelling."
    ),
  ].join("\n");
}

export { cancelCommand, checkHash, renderCancel };
export type { CancelResult };
