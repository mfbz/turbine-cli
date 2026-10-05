// Where wallets live: turbine-cli's own folder, and Foundry's keystores so existing `cast wallet`
// users can trade with the wallets they already have. Both hold encrypted Web3 Secret Storage files.
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { getAddress } from "viem";

import { CliError } from "../output/errors.ts";
import type { Keystore } from "./keystore.ts";
import { readPrivateFile } from "./private-file.ts";
import type { Hex } from "./signer.ts";

type WalletSource = "turbine" | "foundry";
type WalletDirs = { turbine: string; foundry: string };
type WalletRef = {
  name: string;
  source: WalletSource;
  path: string;
  address: Hex | null;
};

// Letters, digits, ".", "-" and "_", starting with a letter or digit and never "..": a name can
// never become a path. Wide enough for Foundry's names, including cast's UUIDs.
const NAME = /^(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
// A keystore is under 1 KB; anything much bigger isn't one.
const MAX_FILE_BYTES = 64 * 1024;
const INVALID = {
  unreadable: "WALLET_FILE_INVALID",
  tooOpen: "WALLET_FILE_TOO_OPEN",
  invalid: "WALLET_FILE_INVALID",
} as const;

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
    // Listing never needs the owner-only check; it reads the public address field only.
    const text = readPrivateFile(path, {
      maxBytes: MAX_FILE_BYTES,
      platform: "win32",
      codes: INVALID,
    });
    const address = (JSON.parse(text) as { address?: unknown }).address;
    return typeof address === "string" &&
      /^(?:0x)?[0-9a-fA-F]{40}$/.test(address)
      ? getAddress(`0x${address.replace(/^0x/, "")}`)
      : null;
  } catch {
    return null;
  }
}

function refsIn(dir: string, source: WalletSource): WalletRef[] {
  if (!existsSync(dir)) return [];
  return (
    readdirSync(dir)
      .map((file) => ({
        file,
        name: source === "turbine" ? file.replace(/\.json$/, "") : file,
      }))
      .filter(
        ({ file, name }) =>
          NAME.test(name) && (source === "foundry" || file.endsWith(".json"))
      )
      // Only regular files: a link could point at any file on the computer.
      .filter(({ file }) => lstatSync(join(dir, file)).isFile())
      .map(({ file, name }) => {
        const path = join(dir, file);
        return { name, source, path, address: declaredAddress(path) };
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  );
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
  const text = readPrivateFile(ref.path, {
    maxBytes: MAX_FILE_BYTES,
    platform,
    codes: INVALID,
  });
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new CliError(
      "WALLET_FILE_INVALID",
      { path: ref.path },
      { cause: error }
    );
  }
}

function prepareFolder(dir: string): void {
  const params = { path: dir };
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    // A link here would let chmod and the save land somewhere else.
    if (!lstatSync(dir).isDirectory())
      throw new CliError("WALLET_STORAGE_FAILED", params);
    chmodSync(dir, 0o700);
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError("WALLET_STORAGE_FAILED", params, { cause: error });
  }
}

function saveWallet(
  name: string,
  keystore: Keystore,
  dirs: WalletDirs
): string {
  checkName(name);
  prepareFolder(dirs.turbine);
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
    throw new CliError(
      "WALLET_STORAGE_FAILED",
      { path: dirs.turbine },
      { cause: error }
    );
  }
  return path;
}

export { findWallet, listWallets, readWallet, saveWallet, walletDirs };
export type { WalletDirs, WalletRef, WalletSource };
