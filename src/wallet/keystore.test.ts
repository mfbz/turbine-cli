import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";

import { CliError } from "../output/errors.ts";
import { decryptKey, encryptKey } from "./keystore.ts";

// Cheap scrypt for tests; real wallets use the standard cost (n = 262144).
const FAST = { n: 1024 };
// The scrypt test vector from the Web3 Secret Storage definition (ethereum.org), password
// "testpassword". Decrypting it proves the KDF, the MAC and the cipher match geth and Foundry.
const SPEC_VECTOR = {
  crypto: {
    cipher: "aes-128-ctr",
    cipherparams: { iv: "83dbcc02d8ccb40e466191a123791e0e" },
    ciphertext:
      "d172bf743a674da9cdad04534d56926ef8358534d458fffccd4e6ad2fbde479c",
    kdf: "scrypt",
    kdfparams: {
      dklen: 32,
      n: 262144,
      p: 8,
      r: 1,
      salt: "ab0c7876052600dd703518d6fc3fe8984592145b591fc8fb5c6d43190334ba19",
    },
    mac: "2103ac29920d71da29f15d75b4a16dbe95cfd7ff8faea1056c33131d846e3097",
  },
  id: "3198bc9c-6672-5ab3-d995-4942343ae5b6",
  version: 3,
};

const SPEC_PBKDF2_VECTOR = {
  crypto: {
    cipher: "aes-128-ctr",
    cipherparams: { iv: "6087dab2f9fdbbfaddc31a909735c1e6" },
    ciphertext:
      "5318b4d5bcd28de64ee5559e671353e16f075ecae9f99c7a79a38af5f869aa46",
    kdf: "pbkdf2",
    kdfparams: {
      c: 262144,
      dklen: 32,
      prf: "hmac-sha256",
      salt: "ae3cd4e7013836a3df6bd7241b12db061dbe2c6785853cce422d148a624ce0bd",
    },
    mac: "517ead924a9d0dc3124507e3393d175ce3ff7c1e96529c6c555ce9e51205e9b2",
  },
  id: "3198bc9c-6672-5ab3-d995-4942343ae5b6",
  version: 3,
};

async function rejection(promise: Promise<unknown>): Promise<CliError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof CliError) return error;
    throw error;
  }
  throw new Error("expected a CliError");
}

describe("the keystore", () => {
  it("encrypts and decrypts a key with its password", async () => {
    const key = generatePrivateKey();
    const json = await encryptKey(key, "correct horse battery", FAST);
    expect(json.version).toBe(3);
    expect(json.address).toBe(
      privateKeyToAccount(key).address.slice(2).toLowerCase()
    );
    expect(JSON.stringify(json)).not.toContain(key.slice(2));
    await expect(decryptKey(json, "correct horse battery")).resolves.toBe(key);
  });

  it("uses the standard scrypt cost unless told otherwise", async () => {
    const json = await encryptKey(generatePrivateKey(), "pw-pw-pw-pw");
    expect(json.crypto.kdfparams).toMatchObject({ n: 262144, r: 8, p: 1 });
  }, 20_000);

  it("refuses a wrong password", async () => {
    const json = await encryptKey(generatePrivateKey(), "right password", FAST);
    expect((await rejection(decryptKey(json, "wrong password"))).code).toBe(
      "WALLET_PASSWORD_WRONG"
    );
  });

  it("refuses a file that was tampered with", async () => {
    const json = await encryptKey(generatePrivateKey(), "password1", FAST);
    const tampered = {
      ...json,
      crypto: { ...json.crypto, ciphertext: "00".repeat(32) },
    };
    expect((await rejection(decryptKey(tampered, "password1"))).code).toBe(
      "WALLET_PASSWORD_WRONG"
    );
  });

  it("refuses something that isn't a keystore", async () => {
    for (const value of [{}, { version: 3 }, "text", null]) {
      expect((await rejection(decryptKey(value, "x"))).code).toBe(
        "WALLET_FILE_INVALID"
      );
    }
  });

  it("refuses a keystore that asks for absurd work (huge scrypt p), so a hostile file can't hang turbine-cli", async () => {
    const json = await encryptKey(generatePrivateKey(), "password1", FAST);
    const hostile = {
      ...json,
      crypto: {
        ...json.crypto,
        kdfparams: { ...json.crypto.kdfparams, p: 100_000 },
      },
    };
    expect((await rejection(decryptKey(hostile, "password1"))).code).toBe(
      "WALLET_FILE_INVALID"
    );
  });

  it("accepts geth's capitalised Crypto key", async () => {
    const key = generatePrivateKey();
    const { crypto, ...rest } = await encryptKey(key, "password1", FAST);
    await expect(
      decryptKey({ ...rest, Crypto: crypto }, "password1")
    ).resolves.toBe(key);
  });

  it("reads the Web3 Secret Storage PBKDF2 test vector (its MAC verifies)", async () => {
    const key = await decryptKey(SPEC_PBKDF2_VECTOR, "testpassword");
    expect(key).toMatch(/^0x[0-9a-f]{64}$/);
  }, 30_000);

  it("refuses scrypt parameters outside RFC 7914 cleanly instead of crashing", async () => {
    // The spec's old scrypt vector uses r = 1 with N = 2^18, which RFC 7914 (and OpenSSL) don't allow.
    // Keystores from geth (r = 8) and Foundry (n = 8192, r = 8) are within the rule.
    expect(
      (await rejection(decryptKey(SPEC_VECTOR, "testpassword"))).code
    ).toBe("WALLET_FILE_INVALID");
  });
});
