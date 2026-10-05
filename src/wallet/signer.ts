// Unlocking a wallet: where the password comes from, and what a command gets back. Commands get a viem
// account (something that signs), never the key; the key and password are returned only so the output
// layer can make sure neither ever appears in what turbine-cli prints.
import { readFileSync, statSync } from "node:fs";

import { privateKeyToAccount } from "viem/accounts";
import type { PrivateKeyAccount } from "viem/accounts";

import { CliError } from "../output/errors.ts";
import { decryptKey } from "./keystore.ts";
import { readWallet } from "./store.ts";
import type { WalletRef } from "./store.ts";

type Hex = `0x${string}`;
type Prompter = { secret(message: string): Promise<string | undefined> };
type PasswordSources = {
  file?: string;
  env?: string;
  prompter?: Prompter;
  tty: boolean;
  platform: NodeJS.Platform;
};
type Unlocked = { account: PrivateKeyAccount; secrets: string[] };

const MIN_PASSWORD = 8;
const MAX_PASSWORD_FILE_BYTES = 4096;
const NOT_OWNER_ONLY = 0o077;

function readPasswordFile(path: string, platform: NodeJS.Platform): string {
  const params = { path };
  let text: string;
  try {
    const stat = statSync(path);
    if (!stat.isFile() || stat.size > MAX_PASSWORD_FILE_BYTES)
      throw new CliError("PASSWORD_FILE_UNREADABLE", params);
    if (platform !== "win32" && (stat.mode & NOT_OWNER_ONLY) !== 0)
      throw new CliError("PASSWORD_FILE_TOO_OPEN", params);
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError("PASSWORD_FILE_UNREADABLE", params, { cause: error });
  }
  // Editors and `echo` end files with a newline; it is never part of the password.
  return text.replace(/\r?\n$/, "");
}

async function ask(prompter: Prompter, message: string): Promise<string> {
  const answer = await prompter.secret(message);
  if (answer === undefined) throw new CliError("CANCELLED");
  return answer;
}

/** The password, from --password-file, then TURBINE_WALLET_PASSWORD, then a hidden prompt. */
async function readPassword(
  sources: PasswordSources,
  purpose: "unlock" | "new"
): Promise<string> {
  let password: string;
  if (sources.file) password = readPasswordFile(sources.file, sources.platform);
  else if (sources.env) password = sources.env;
  else if (sources.tty && sources.prompter) {
    password = await ask(
      sources.prompter,
      purpose === "new"
        ? "Choose a password for this wallet"
        : "Wallet password"
    );
    if (purpose === "new") {
      if (password.length < MIN_PASSWORD)
        throw new CliError("PASSWORD_TOO_SHORT");
      const again = await ask(sources.prompter, "The same password again");
      if (again !== password) throw new CliError("PASSWORDS_DIFFER");
    }
  } else {
    // No terminal and no password given: fail now, never wait for input that can't come.
    throw new CliError("PASSWORD_REQUIRED");
  }
  if (purpose === "new" && password.length < MIN_PASSWORD)
    throw new CliError("PASSWORD_TOO_SHORT");
  return password;
}

async function unlockWallet(
  ref: WalletRef,
  sources: PasswordSources
): Promise<Unlocked> {
  const keystore = readWallet(ref, sources.platform);
  const password = await readPassword(sources, "unlock");
  const privateKey = await decryptKey(keystore, password);
  return {
    account: privateKeyToAccount(privateKey),
    secrets: [privateKey, password],
  };
}

export { readPassword, unlockWallet };
export type { Hex, PasswordSources, Prompter, Unlocked };
