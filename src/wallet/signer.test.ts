import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, describe, expect, it } from "vitest";

import { CliError } from "../output/errors.ts";
import { encryptKey } from "./keystore.ts";
import { readPassword, unlockWallet } from "./signer.ts";
import type { PasswordSources, Prompter } from "./signer.ts";
import { findWallet, saveWallet } from "./store.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "turbine-signer-"));
  roots.push(dir);
  return dir;
}

function prompter(...answers: Array<string | undefined>): Prompter {
  return { secret: () => Promise.resolve(answers.shift()) };
}

function sources(over: Partial<PasswordSources> = {}): PasswordSources {
  return { tty: false, platform: "darwin", ...over };
}

async function rejection(promise: Promise<unknown>): Promise<CliError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof CliError) return error;
    throw error;
  }
  throw new Error("expected a CliError");
}

describe("readPassword", () => {
  it("prefers a password file, without its trailing newline", async () => {
    const file = join(tempDir(), "pw");
    writeFileSync(file, "from the file\n", { mode: 0o600 });
    await expect(
      readPassword(sources({ file, env: "from env" }), "unlock")
    ).resolves.toBe("from the file");
  });

  it("refuses a password file others can read", async () => {
    const file = join(tempDir(), "pw");
    writeFileSync(file, "secret12\n", { mode: 0o644 });
    expect(
      (await rejection(readPassword(sources({ file }), "unlock"))).code
    ).toBe("PASSWORD_FILE_TOO_OPEN");
  });

  it("names a password file it can't read", async () => {
    const error = await rejection(
      readPassword(sources({ file: "/no/such/file" }), "unlock")
    );
    expect(error.code).toBe("PASSWORD_FILE_UNREADABLE");
  });

  it("uses TURBINE_WALLET_PASSWORD next", async () => {
    await expect(
      readPassword(sources({ env: "from env 1" }), "unlock")
    ).resolves.toBe("from env 1");
  });

  it("asks in a terminal, and fails rather than hangs without one", async () => {
    await expect(
      readPassword(
        sources({ tty: true, prompter: prompter("typed it") }),
        "unlock"
      )
    ).resolves.toBe("typed it");
    expect((await rejection(readPassword(sources(), "unlock"))).code).toBe(
      "PASSWORD_REQUIRED"
    );
  });

  it("treats a cancelled prompt as cancelled", async () => {
    const error = await rejection(
      readPassword(
        sources({ tty: true, prompter: prompter(undefined) }),
        "unlock"
      )
    );
    expect(error.code).toBe("CANCELLED");
  });

  it("asks twice for a new wallet and insists on 8 characters", async () => {
    await expect(
      readPassword(
        sources({
          tty: true,
          prompter: prompter("long enough", "long enough"),
        }),
        "new"
      )
    ).resolves.toBe("long enough");
    expect(
      (
        await rejection(
          readPassword(
            sources({ tty: true, prompter: prompter("aaaaaaaa", "bbbbbbbb") }),
            "new"
          )
        )
      ).code
    ).toBe("PASSWORDS_DIFFER");
    expect(
      (await rejection(readPassword(sources({ env: "short" }), "new"))).code
    ).toBe("PASSWORD_TOO_SHORT");
  });
});

describe("unlockWallet", () => {
  it("returns an account that signs, and the secrets to keep out of every output", async () => {
    const dirs = {
      turbine: join(tempDir(), "w"),
      foundry: join(tempDir(), "f"),
    };
    const key = generatePrivateKey();
    saveWallet("main", await encryptKey(key, "password1", { n: 1024 }), dirs);
    const { account, secrets } = await unlockWallet(
      findWallet("main", dirs),
      sources({ env: "password1" })
    );
    expect(account.address).toBe(privateKeyToAccount(key).address);
    expect(Object.values(account)).not.toContain(key);
    expect(secrets).toEqual(expect.arrayContaining([key, "password1"]));
  });

  it("refuses the wrong password", async () => {
    const dirs = {
      turbine: join(tempDir(), "w"),
      foundry: join(tempDir(), "f"),
    };
    saveWallet(
      "main",
      await encryptKey(generatePrivateKey(), "password1", { n: 1024 }),
      dirs
    );
    const error = await rejection(
      unlockWallet(findWallet("main", dirs), sources({ env: "password2" }))
    );
    expect(error.code).toBe("WALLET_PASSWORD_WRONG");
  });
});
