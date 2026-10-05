// Where wallets live: turbine-cli's own folder, and Foundry's keystores so existing `cast wallet`
// users can trade with the wallets they already have. Both hold encrypted Web3 Secret Storage files.
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { CliError } from "../output/errors.ts";
import type { Keystore } from "./keystore.ts";
import type { Hex } from "./signer.ts";

type WalletSource = "turbine" | "foundry";
type WalletDirs = { turbine: string; foundry: string };
type WalletRef = {
  name: string;
  source: WalletSource;
  path: string;
  address: Hex | null;
};

// Letters, digits, - and _: a name can never become a path.
const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
// A keystore is under 1 KB; anything much bigger isn't one.
const MAX_FILE_BYTES = 64 * 1024;
// Group and others: any of their read, write or execute bits.
const NOT_OWNER_ONLY = 0o077;

function walletDirs(
  env: Record<string, string | undefined>,
  home: string,
  platform: NodeJS.Platform
): WalletDirs {
  const config =
    platform === "win32"
      ? (env.APPDATA ?? join(home, "AppData", "Roaming"))
      : (env.XDG_CONFIG_HOME ?? join(home, ".config"));
  return {
    turbine: join(config, "turbine-cli", "wallets"),
    foundry: join(home, ".foundry", "keystores"),
  };
}

function checkName(name: string): void {
  if (!NAME.test(name)) throw new CliError("WALLET_NAME_INVALID");
}

function declaredAddress(path: string): Hex | null {
  try {
    if (statSync(path).size > MAX_FILE_BYTES) return null;
    const json: unknown = JSON.parse(readFileSync(path, "utf8"));
    const address = (json as { address?: unknown }).address;
    return typeof address === "string" &&
      /^(?:0x)?[0-9a-fA-F]{40}$/.test(address)
      ? `0x${address.replace(/^0x/, "").toLowerCase()}`
      : null;
  } catch {
    return null;
  }
}

function refsIn(dir: string, source: WalletSource): WalletRef[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((file) => ({
      file,
      name: source === "turbine" ? file.replace(/\.json$/, "") : file,
    }))
    .filter(
      ({ file, name }) =>
        NAME.test(name) && (source === "foundry" || file.endsWith(".json"))
    )
    .map(({ file, name }) => {
      const path = join(dir, file);
      return { name, source, path, address: declaredAddress(path) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function listWallets(dirs: WalletDirs): WalletRef[] {
  return [
    ...refsIn(dirs.turbine, "turbine"),
    ...refsIn(dirs.foundry, "foundry"),
  ];
}

function findWallet(name: string, dirs: WalletDirs): WalletRef {
  checkName(name);
  const found = listWallets(dirs).find((ref) => ref.name === name);
  if (!found) throw new CliError("WALLET_NOT_FOUND", { name });
  return found;
}

function readWallet(ref: WalletRef, platform: NodeJS.Platform): unknown {
  const params = { path: ref.path };
  const stat = statSync(ref.path);
  // A pipe would block forever and a huge file would fill memory; a keystore is a small regular file.
  if (!stat.isFile() || stat.size > MAX_FILE_BYTES)
    throw new CliError("WALLET_FILE_INVALID", params);
  // Windows has no POSIX modes; NTFS permissions are the user's to set.
  if (platform !== "win32" && (stat.mode & NOT_OWNER_ONLY) !== 0)
    throw new CliError("WALLET_FILE_TOO_OPEN", params);
  try {
    return JSON.parse(readFileSync(ref.path, "utf8")) as unknown;
  } catch (error) {
    throw new CliError("WALLET_FILE_INVALID", params, { cause: error });
  }
}

function saveWallet(
  name: string,
  keystore: Keystore,
  dirs: WalletDirs
): string {
  checkName(name);
  mkdirSync(dirs.turbine, { recursive: true, mode: 0o700 });
  chmodSync(dirs.turbine, 0o700);
  const path = join(dirs.turbine, `${name}.json`);
  try {
    // "wx": create only. An existing wallet is never overwritten, even by a race.
    writeFileSync(path, `${JSON.stringify(keystore, null, 2)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new CliError("WALLET_EXISTS", { name }, { cause: error });
    throw error;
  }
  return path;
}

export { findWallet, listWallets, readWallet, saveWallet, walletDirs };
export type { WalletDirs, WalletRef, WalletSource };
