import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";

import { CliError } from "../output/errors.ts";
import { loadKey } from "./key.ts";
import type { KeyFs } from "./key.ts";

function fakeFs(
  files: Record<string, { text: string; mode: number }>,
  platform: NodeJS.Platform = "darwin"
): KeyFs {
  const get = (path: string) => {
    const file = files[path];
    if (!file) throw new Error(`ENOENT: no such file, open '${path}'`);
    return file;
  };
  return {
    readFile: (path) => get(path).text,
    mode: (path) => get(path).mode,
    platform,
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

describe("loadKey", () => {
  it("returns nothing when no key is configured", () => {
    expect(loadKey({}, fakeFs({}))).toBeUndefined();
  });

  it("reads the key from the environment, with or without 0x, and trims whitespace", () => {
    const key = generatePrivateKey();
    const { address } = privateKeyToAccount(key);
    for (const value of [key, key.slice(2), `  ${key}\n`]) {
      expect(loadKey({ privateKey: value }, fakeFs({}))).toEqual({
        privateKey: key,
        address,
        source: "env",
      });
    }
  });

  it("reads the key from an owner-only file, ending newline and all", () => {
    const key = generatePrivateKey();
    const fs = fakeFs({ "/k": { text: `${key}\n`, mode: 0o100600 } });
    expect(loadKey({ keyFile: "/k" }, fs)).toMatchObject({
      privateKey: key,
      source: "file",
    });
  });

  it("refuses a key file others can read, and says how to fix it", () => {
    const fs = fakeFs({
      "/k": { text: generatePrivateKey(), mode: 0o100644 },
    });
    const error = thrown(() => loadKey({ keyFile: "/k" }, fs));
    expect(error.code).toBe("KEY_FILE_TOO_OPEN");
    expect(error.hint).toContain("chmod 600 /k");
  });

  it("skips the permission check on Windows, where modes don't apply", () => {
    const fs = fakeFs(
      { "C:\\k": { text: generatePrivateKey(), mode: 0o100666 } },
      "win32"
    );
    expect(loadKey({ keyFile: "C:\\k" }, fs)?.source).toBe("file");
  });

  it("refuses two keys at once instead of guessing", () => {
    const fs = fakeFs({ "/k": { text: generatePrivateKey(), mode: 0o100600 } });
    expect(
      thrown(() =>
        loadKey({ privateKey: generatePrivateKey(), keyFile: "/k" }, fs)
      ).code
    ).toBe("KEY_AMBIGUOUS");
  });

  it("rejects something that isn't a key without repeating it", () => {
    const almost = generatePrivateKey().slice(0, 60);
    const error = thrown(() => loadKey({ privateKey: almost }, fakeFs({})));
    expect(error.code).toBe("KEY_INVALID");
    expect(`${error.message} ${error.hint ?? ""}`).not.toContain(
      almost.slice(2, 20)
    );
  });

  it("names an unreadable key file", () => {
    const error = thrown(() => loadKey({ keyFile: "/missing" }, fakeFs({})));
    expect(error.code).toBe("KEY_FILE_UNREADABLE");
    expect(error.message).toContain("/missing");
  });
});
