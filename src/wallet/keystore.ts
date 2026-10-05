// Web3 Secret Storage v3: the encrypted keystore format of geth, Foundry and most Ethereum tools, so a
// wallet made here works there and the other way round. https://ethereum.org/developers/docs/data-structures-and-encoding/web3-secret-storage/
import {
  createCipheriv,
  createDecipheriv,
  pbkdf2,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

import { bytesToHex, hexToBytes, keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";

import { CliError } from "../output/errors.ts";
import type { Hex } from "./signer.ts";

type Keystore = z.infer<typeof KEYSTORE>;

const HEX = z.string().regex(/^(?:0x)?[0-9a-fA-F]*$/);
const SCRYPT = z.object({
  kdf: z.literal("scrypt"),
  kdfparams: z.object({
    dklen: z.literal(32),
    n: z.number().int().positive(),
    r: z.number().int().positive(),
    p: z.number().int().positive(),
    salt: HEX,
  }),
});
const PBKDF2 = z.object({
  kdf: z.literal("pbkdf2"),
  kdfparams: z.object({
    dklen: z.literal(32),
    c: z.number().int().positive(),
    prf: z.literal("hmac-sha256"),
    salt: HEX,
  }),
});
const KEYSTORE = z.object({
  version: z.literal(3),
  id: z.string().optional(),
  address: z.string().optional(),
  crypto: z.intersection(
    z.object({
      cipher: z.literal("aes-128-ctr"),
      cipherparams: z.object({ iv: HEX }),
      ciphertext: HEX,
      mac: HEX,
    }),
    z.discriminatedUnion("kdf", [SCRYPT, PBKDF2])
  ),
});
// geth's "standard" cost: about a second and 256 MB to try one password.
const STANDARD_N = 262_144;
// Upper bounds on what a file may ask for, so a hostile keystore can't exhaust memory or time.
const MAX_SCRYPT_MEMORY = 1024 * 1024 * 1024;
const MAX_PBKDF2_ROUNDS = 10_000_000;
// scrypt's time grows with p as well; standard keystores use p = 1.
const MAX_SCRYPT_P = 16;
const MAX_SCRYPT_WORK = 4 * 128 * STANDARD_N * 8;

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number }
) => Promise<Buffer>;
const pbkdf2Async = promisify(pbkdf2);

function bytes(hex: string): Buffer {
  return Buffer.from(hex.replace(/^0x/, ""), "hex");
}

function mac(derived: Buffer, ciphertext: Buffer): Buffer {
  return Buffer.from(
    hexToBytes(
      keccak256(
        bytesToHex(Buffer.concat([derived.subarray(16, 32), ciphertext]))
      )
    )
  );
}

async function derive(
  password: string,
  crypto: Keystore["crypto"]
): Promise<Buffer> {
  const salt = bytes(crypto.kdfparams.salt);
  if (crypto.kdf === "scrypt") {
    const { n, r, p } = crypto.kdfparams;
    if (
      128 * n * r > MAX_SCRYPT_MEMORY ||
      p > MAX_SCRYPT_P ||
      128 * n * r * p > MAX_SCRYPT_WORK
    )
      throw new CliError("WALLET_FILE_INVALID");
    try {
      return await scryptAsync(password, salt, 32, {
        N: n,
        r,
        p,
        maxmem: MAX_SCRYPT_MEMORY + 1024 * 1024,
      });
    } catch (error) {
      // Parameters outside RFC 7914 (r = 1 with a large N, as in the spec's old example), which
      // OpenSSL refuses. Keystores from geth and Foundry are within the rule.
      throw new CliError("WALLET_FILE_INVALID", {}, { cause: error });
    }
  }
  if (crypto.kdfparams.c > MAX_PBKDF2_ROUNDS)
    throw new CliError("WALLET_FILE_INVALID");
  return pbkdf2Async(password, salt, crypto.kdfparams.c, 32, "sha256");
}

async function encryptKey(
  privateKey: Hex,
  password: string,
  options: { n?: number } = {}
): Promise<Keystore> {
  const salt = randomBytes(32);
  const iv = randomBytes(16);
  const n = options.n ?? STANDARD_N;
  const derived = await scryptAsync(password, salt, 32, {
    N: n,
    r: 8,
    p: 1,
    maxmem: MAX_SCRYPT_MEMORY + 1024 * 1024,
  });
  const cipher = createCipheriv("aes-128-ctr", derived.subarray(0, 16), iv);
  const ciphertext = Buffer.concat([
    cipher.update(bytes(privateKey)),
    cipher.final(),
  ]);
  return {
    version: 3,
    id: randomUUID(),
    address: privateKeyToAccount(privateKey).address.slice(2).toLowerCase(),
    crypto: {
      cipher: "aes-128-ctr",
      cipherparams: { iv: iv.toString("hex") },
      ciphertext: ciphertext.toString("hex"),
      kdf: "scrypt",
      kdfparams: { dklen: 32, n, r: 8, p: 1, salt: salt.toString("hex") },
      mac: mac(derived, ciphertext).toString("hex"),
    },
  };
}

// geth writes "crypto" but has also written "Crypto", and reads either.
function normalise(json: unknown): unknown {
  if (typeof json !== "object" || json === null) return json;
  const { Crypto, crypto, ...rest } = json as Record<string, unknown>;
  return { ...rest, crypto: crypto ?? Crypto };
}

async function decryptKey(json: unknown, password: string): Promise<Hex> {
  const parsed = KEYSTORE.safeParse(normalise(json));
  if (!parsed.success) throw new CliError("WALLET_FILE_INVALID");
  const { crypto } = parsed.data;
  const derived = await derive(password, crypto);
  const ciphertext = bytes(crypto.ciphertext);
  const expected = bytes(crypto.mac);
  const actual = mac(derived, ciphertext);
  // A wrong password and a tampered file look the same: the MAC doesn't match.
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
    throw new CliError("WALLET_PASSWORD_WRONG");
  const decipher = createDecipheriv(
    "aes-128-ctr",
    derived.subarray(0, 16),
    bytes(crypto.cipherparams.iv)
  );
  const key = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  if (key.length !== 32) throw new CliError("WALLET_FILE_INVALID");
  return `0x${key.toString("hex")}`;
}

export { decryptKey, encryptKey };
export type { Keystore };
