import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { getAddress } from "viem";
import { generatePrivateKey } from "viem/accounts";
import { afterEach, describe, expect, it } from "vitest";

import { CliError } from "../output/errors.ts";
import { encryptKey } from "./keystore.ts";
import {
  findWallet,
  listWallets,
  readWallet,
  saveWallet,
  walletDirs,
} from "./store.ts";
import type { WalletDirs } from "./store.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function dirs(): WalletDirs {
  const root = mkdtempSync(join(tmpdir(), "turbine-wallets-"));
  roots.push(root);
  return {
    turbine: join(root, "turbine-cli", "wallets"),
    foundry: join(root, ".foundry", "keystores"),
  };
}

function thrown(fn: () => unknown): CliError {
  try {
    fn();
  } catch (error) {
    if (error instanceof CliError) return error;
    throw error;
  }
  throw new Error("expected a CliError");
}

async function keystore() {
  return encryptKey(generatePrivateKey(), "password1", { n: 1024 });
}

describe("walletDirs", () => {
  it("follows XDG on Linux and macOS, APPDATA on Windows, and knows Foundry's folder", () => {
    expect(walletDirs({}, "/home/u", "linux")).toEqual({
      turbine: "/home/u/.config/turbine-cli/wallets",
      foundry: "/home/u/.foundry/keystores",
    });
    expect(
      walletDirs({ XDG_CONFIG_HOME: "/x" }, "/home/u", "darwin").turbine
    ).toBe("/x/turbine-cli/wallets");
    expect(
      walletDirs(
        { APPDATA: "C:\\Users\\u\\AppData\\Roaming" },
        "C:\\Users\\u",
        "win32"
      ).turbine
    ).toContain("turbine-cli");
  });
});

describe("the wallet store", () => {
  it("saves a wallet only the owner can read, in a folder only the owner can open", async () => {
    const d = dirs();
    const path = saveWallet("trading", await keystore(), d);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(d.turbine).mode & 0o777).toBe(0o700);
    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({
      version: 3,
    });
  });

  it("never overwrites a wallet", async () => {
    const d = dirs();
    saveWallet("trading", await keystore(), d);
    expect(thrown(() => saveWallet("trading", {} as never, d)).code).toBe(
      "WALLET_EXISTS"
    );
  });

  it("only accepts simple names, so a name can never become a path", () => {
    const d = dirs();
    for (const name of [
      "../x",
      "a/b",
      "",
      "x".repeat(65),
      "a b",
      "..",
      ".hidden",
    ]) {
      expect(thrown(() => saveWallet(name, {} as never, d)).code, name).toBe(
        "WALLET_NAME_INVALID"
      );
    }
    expect(thrown(() => findWallet("../etc", d)).code).toBe(
      "WALLET_NAME_INVALID"
    );
  });

  it("lists its own wallets and Foundry's, with the address each file declares", async () => {
    const d = dirs();
    const json = await keystore();
    saveWallet("trading", json, d);
    mkdirSync(d.foundry, { recursive: true });
    writeFileSync(join(d.foundry, "deployer"), JSON.stringify(json), {
      mode: 0o600,
    });
    expect(listWallets(d)).toEqual([
      expect.objectContaining({
        name: "trading",
        source: "turbine",
        address: getAddress(`0x${json.address}`),
      }),
      expect.objectContaining({ name: "deployer", source: "foundry" }),
    ]);
  });

  it("finds turbine-cli's wallet before Foundry's of the same name", async () => {
    const d = dirs();
    saveWallet("same", await keystore(), d);
    mkdirSync(d.foundry, { recursive: true });
    writeFileSync(join(d.foundry, "same"), "{}", { mode: 0o600 });
    expect(findWallet("same", d).source).toBe("turbine");
    expect(thrown(() => findWallet("missing", d)).code).toBe(
      "WALLET_NOT_FOUND"
    );
  });

  it("lists Foundry keystores named the way cast names them (UUIDs, dots)", async () => {
    const d = dirs();
    mkdirSync(d.foundry, { recursive: true });
    const json = JSON.stringify(await keystore());
    for (const name of ["0f8b3c1e-7a2d-4c1b-9e3f-2a4b6c8d0e1f", "my.deployer"])
      writeFileSync(join(d.foundry, name), json, { mode: 0o600 });
    expect(listWallets(d).map((w) => w.name)).toEqual([
      "0f8b3c1e-7a2d-4c1b-9e3f-2a4b6c8d0e1f",
      "my.deployer",
    ]);
    expect(thrown(() => findWallet("..", d)).code).toBe("WALLET_NAME_INVALID");
  });

  it("refuses a wallet file that is a symlink, and a wallets folder that is one", async () => {
    const d = dirs();
    mkdirSync(d.turbine, { recursive: true, mode: 0o700 });
    const elsewhere = join(dirname(d.turbine), "elsewhere.json");
    writeFileSync(elsewhere, JSON.stringify(await keystore()), { mode: 0o600 });
    symlinkSync(elsewhere, join(d.turbine, "linked.json"));
    expect(listWallets(d).map((w) => w.name)).not.toContain("linked");

    const d2 = dirs();
    const real = join(dirname(d2.turbine), "real");
    mkdirSync(dirname(d2.turbine), { recursive: true });
    mkdirSync(real, { mode: 0o755 });
    symlinkSync(real, d2.turbine);
    expect(thrown(() => saveWallet("x", {} as never, d2)).code).toBe(
      "WALLET_STORAGE_FAILED"
    );
    expect(statSync(real).mode & 0o777).toBe(0o755);
  });

  it("reports a wallets folder it can't create in its own words", () => {
    const root = mkdtempSync(join(tmpdir(), "turbine-blocked-"));
    roots.push(root);
    writeFileSync(join(root, "file"), "");
    const d = {
      turbine: join(root, "file", "wallets"),
      foundry: join(root, "f"),
    };
    expect(thrown(() => saveWallet("x", {} as never, d)).code).toBe(
      "WALLET_STORAGE_FAILED"
    );
  });

  it("refuses to read a wallet file others can read", async () => {
    const d = dirs();
    const path = saveWallet("open", await keystore(), d);
    chmodSync(path, 0o644);
    expect(thrown(() => readWallet(findWallet("open", d), "darwin")).code).toBe(
      "WALLET_FILE_TOO_OPEN"
    );
    expect(readWallet(findWallet("open", d), "win32")).toMatchObject({
      version: 3,
    });
  });

  it("doesn't list a folder as a wallet", () => {
    const d = dirs();
    mkdirSync(join(d.turbine, "dir.json"), { recursive: true, mode: 0o700 });
    expect(listWallets(d)).toEqual([]);
  });

  it("refuses something that isn't a regular, small JSON file", () => {
    const d = dirs();
    mkdirSync(d.turbine, { recursive: true, mode: 0o700 });
    writeFileSync(join(d.turbine, "junk.json"), "not json", { mode: 0o600 });
    writeFileSync(join(d.turbine, "huge.json"), "x".repeat(70_000), {
      mode: 0o600,
    });
    for (const name of ["junk", "huge"]) {
      expect(
        thrown(() => readWallet(findWallet(name, d), "darwin")).code,
        name
      ).toBe("WALLET_FILE_INVALID");
    }
  });
});
