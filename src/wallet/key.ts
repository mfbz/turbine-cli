// The one place that reads the signing key. Everything else gets a LoadedKey, and every output goes
// through redact() with this key, so it can't reach a terminal, a log or a --json document.
import { readFileSync, statSync } from "node:fs";

import { privateKeyToAccount } from "viem/accounts";

import type { Env } from "../config/env.ts";
import { CliError } from "../output/errors.ts";

type Hex = `0x${string}`;
type KeySource = "env" | "file";
type LoadedKey = { privateKey: Hex; address: Hex; source: KeySource };
type KeyFs = {
  readFile(path: string): string;
  mode(path: string): number;
  platform: NodeJS.Platform;
};

const KEY = /^(?:0x)?([0-9a-fA-F]{64})$/;
// Group and others: any of their read, write or execute bits.
const NOT_OWNER_ONLY = 0o077;

const realKeyFs: KeyFs = {
  readFile: (path) => readFileSync(path, "utf8"),
  mode: (path) => statSync(path).mode,
  platform: process.platform,
};

function parseKey(text: string, source: KeySource): Hex {
  const match = KEY.exec(text.trim());
  if (!match?.[1]) {
    // Never quote the input: a near-miss is still most of someone's key.
    throw new CliError(
      "KEY_INVALID",
      source === "env"
        ? "TURBINE_PRIVATE_KEY isn't a private key."
        : "The key file doesn't hold a private key.",
      {
        hint: "A private key is 64 hexadecimal characters, with or without 0x.",
      }
    );
  }
  return `0x${match[1].toLowerCase()}`;
}

function addressOf(privateKey: Hex, source: KeySource): Hex {
  try {
    return privateKeyToAccount(privateKey).address;
  } catch (error) {
    // 64 hex digits outside the curve's range. The library's message quotes the value in decimal,
    // which the hex redaction wouldn't catch, so it is replaced, not passed on.
    throw new CliError(
      "KEY_INVALID",
      source === "env"
        ? "TURBINE_PRIVATE_KEY isn't a valid Ethereum private key."
        : "The key file doesn't hold a valid Ethereum private key.",
      {
        hint: "Check you copied the whole key, from the wallet you mean to use.",
        cause: error,
      }
    );
  }
}

function readKeyFile(path: string, fs: KeyFs): string {
  let mode: number;
  let text: string;
  try {
    mode = fs.mode(path);
    text = fs.readFile(path);
  } catch (error) {
    throw new CliError(
      "KEY_FILE_UNREADABLE",
      `Can't read the key file ${path}.`,
      {
        hint: "Check TURBINE_KEY_FILE points at a file you can read.",
        cause: error,
      }
    );
  }
  // Windows has no POSIX modes; NTFS permissions are the user's to set.
  if (fs.platform !== "win32" && (mode & NOT_OWNER_ONLY) !== 0) {
    throw new CliError(
      "KEY_FILE_TOO_OPEN",
      `The key file ${path} can be read by other users of this computer.`,
      { hint: `Make it yours only: chmod 600 ${path}` }
    );
  }
  return text;
}

function loadKey(env: Env, fs: KeyFs = realKeyFs): LoadedKey | undefined {
  if (env.privateKey && env.keyFile) {
    throw new CliError(
      "KEY_AMBIGUOUS",
      "Both TURBINE_PRIVATE_KEY and TURBINE_KEY_FILE are set.",
      { hint: "Keep one of them, so it's clear which wallet signs." }
    );
  }
  let privateKey: Hex;
  let source: KeySource;
  if (env.privateKey) {
    privateKey = parseKey(env.privateKey, "env");
    source = "env";
  } else if (env.keyFile) {
    privateKey = parseKey(readKeyFile(env.keyFile, fs), "file");
    source = "file";
  } else {
    return undefined;
  }
  return { privateKey, address: addressOf(privateKey, source), source };
}

export { loadKey, realKeyFs };
export type { Hex, KeyFs, KeySource, LoadedKey };
