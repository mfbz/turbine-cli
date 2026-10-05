import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { CliError } from "../output/errors.ts";
import { plain } from "../output/output.ts";
import type { Theme } from "../output/theme.ts";
import { encryptKey } from "../wallet/keystore.ts";
import { readPassword } from "../wallet/signer.ts";
import type { Hex, PasswordSources, Prompter } from "../wallet/signer.ts";
import { findWallet, listWallets, saveWallet } from "../wallet/store.ts";
import type { WalletDirs, WalletRef } from "../wallet/store.ts";

type WalletContext = {
  dirs: WalletDirs;
  sources: PasswordSources;
  // Everything secret this command touches, so the output layer keeps it out of every stream.
  addSecret: (secret: string) => void;
  // Test-only: a cheaper scrypt cost.
  scryptN?: number;
};
type WalletCreated = { name: string; address: Hex; path: string };
type WalletEntry = Omit<WalletRef, "path"> & { path: string };

const KEY = /^(?:0x)?([0-9a-fA-F]{64})$/;

function ensureFree(name: string, dirs: WalletDirs): void {
  try {
    findWallet(name, dirs);
  } catch (error) {
    if (error instanceof CliError && error.code === "WALLET_NOT_FOUND") return;
    throw error;
  }
  throw new CliError("WALLET_EXISTS", { name });
}

async function store(
  name: string,
  privateKey: Hex,
  ctx: WalletContext
): Promise<WalletCreated> {
  const password = await readPassword(ctx.sources, "new");
  ctx.addSecret(password);
  const keystore = await encryptKey(privateKey, password, { n: ctx.scryptN });
  const path = saveWallet(name, keystore, ctx.dirs);
  return { name, address: privateKeyToAccount(privateKey).address, path };
}

async function walletNew(
  name: string,
  ctx: WalletContext
): Promise<WalletCreated> {
  ensureFree(name, ctx.dirs);
  const privateKey = generatePrivateKey();
  ctx.addSecret(privateKey);
  return store(name, privateKey, ctx);
}

async function walletImport(
  name: string,
  ctx: WalletContext & { prompter?: Prompter }
): Promise<WalletCreated> {
  // A key is only ever typed into a hidden prompt: never an argument, a variable or piped input,
  // which all end up in shell history, process lists or logs.
  if (!ctx.sources.tty || !ctx.prompter)
    throw new CliError("TERMINAL_REQUIRED");
  ensureFree(name, ctx.dirs);
  const typed = await ctx.prompter.secret("Private key (hidden)");
  if (typed === undefined) throw new CliError("CANCELLED");
  const trimmed = typed.trim();
  if (trimmed) ctx.addSecret(trimmed);
  const match = KEY.exec(trimmed);
  if (!match?.[1]) throw new CliError("KEY_INVALID");
  const privateKey: Hex = `0x${match[1].toLowerCase()}`;
  ctx.addSecret(privateKey);
  try {
    privateKeyToAccount(privateKey);
  } catch (error) {
    // Outside the curve's range; the library's message would quote the value.
    throw new CliError("KEY_INVALID", {}, { cause: error });
  }
  return store(name, privateKey, ctx);
}

function walletList(dirs: WalletDirs): WalletEntry[] {
  return listWallets(dirs);
}

function renderCreated(created: WalletCreated, theme: Theme): string {
  return [
    `${theme.success("✓")} Wallet ${theme.bold(created.name)} saved, encrypted.`,
    `${theme.dim("address".padEnd(9))}${created.address}`,
    `${theme.dim("file".padEnd(9))}${plain(created.path)}`,
    theme.dim(
      "Keep the password safe: without it this wallet can't be opened."
    ),
  ].join("\n");
}

function renderList(entries: WalletEntry[], theme: Theme): string {
  if (entries.length === 0)
    return theme.dim("No wallets yet. Create one with turbine wallet new.");
  const width = Math.max(...entries.map((e) => e.name.length)) + 2;
  return entries
    .map(
      (e) =>
        `${e.name.padEnd(width)}${e.address ?? theme.dim("address unknown")}${theme.dim(
          e.source === "foundry" ? "  (Foundry)" : ""
        )}`
    )
    .join("\n");
}

export { renderCreated, renderList, walletImport, walletList, walletNew };
export type { WalletContext, WalletCreated };
