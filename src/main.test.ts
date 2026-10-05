import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const MAIN = fileURLToPath(new URL("./main.ts", import.meta.url));

describe("the turbine entry point", () => {
  it("sets the TLS key shares before anything connects", () => {
    const source = readFileSync(MAIN, "utf8");
    const applied = source.indexOf("preferClassicKeyShares(tls)");
    expect(applied).toBeGreaterThan(-1);
    expect(applied).toBeLessThan(source.indexOf("await run("));
  });

  it("runs from source and exits with run()'s code", () => {
    const ok = spawnSync(process.execPath, [MAIN, "--version"], {
      encoding: "utf8",
    });
    expect(ok.status).toBe(0);
    expect(ok.stdout).toMatch(/^\d+\.\d+\.\d+\n$/);
    expect(spawnSync(process.execPath, [MAIN, "--nope"]).status).toBe(2);
  });

  it("exits quietly when the reader closes the pipe early (turbine --help | head -0)", async () => {
    const child = spawn(process.execPath, [MAIN, "--help"]);
    // Close our end before the child has started, so its first write hits a closed pipe.
    child.stdout.destroy();
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    const code = await new Promise<number | null>((resolve) =>
      child.on("close", resolve)
    );
    expect(stderr).not.toContain("EPIPE");
    expect(code).toBe(0);
  });

  it("still prints one JSON document when interrupted mid-request with --json", async () => {
    // A Turbine that accepts the connection and never answers.
    const server = createServer(() => undefined);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve)
    );
    const { port } = server.address() as AddressInfo;
    const connected = new Promise<void>((resolve) =>
      server.once("connection", () => resolve())
    );
    const child = spawn(process.execPath, [MAIN, "tokens", "--json"], {
      env: {
        ...process.env,
        TURBINE_API_URL: `http://127.0.0.1:${port}/api`,
      },
    });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    await connected;
    child.kill("SIGINT");
    const code = await new Promise<number | null>((resolve) =>
      child.on("close", resolve)
    );
    server.close();
    expect(code).toBe(130);
    const doc = JSON.parse(stdout) as { ok: boolean; error: { code: string } };
    expect(doc).toMatchObject({ ok: false, error: { code: "CANCELLED" } });
  });
});
