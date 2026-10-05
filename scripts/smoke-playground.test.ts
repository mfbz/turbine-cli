import { describe, expect, it } from "vitest";

import { runSmoke, STEPS } from "./smoke-playground.ts";

const SIGNING = new Set(["place", "ladder", "cancel", "approve"]);

function ok(data: unknown) {
  return Promise.resolve({
    code: 0,
    stdout: JSON.stringify({ ok: true, data }),
  });
}

describe("the playground smoke test", () => {
  it("only reads or dry-runs, always on the playground, always as JSON", () => {
    for (const step of STEPS) {
      expect(step.args).toContain("--json");
      expect(step.args).not.toContain("mainnet");
      expect(step.args).not.toContain("--yes");
      if (step.args.some((arg) => SIGNING.has(arg)))
        expect(step.args).toContain("--dry-run");
    }
  });

  it("runs every step, and skips the wallet's dry runs when there is no wallet", async () => {
    const ran: string[][] = [];
    const lines: string[] = [];
    const passed = await runSmoke({
      run: (args) => {
        ran.push(args);
        return args[0] === "config" ? ok({ wallet: null }) : ok({});
      },
      log: (line) => lines.push(line),
    });
    expect(passed).toBe(true);
    expect(ran.some((args) => args.includes("--dry-run"))).toBe(false);
    expect(lines.join("\n")).toContain("skipped");
  });

  it("fails on any error document and says which code", async () => {
    const lines: string[] = [];
    const passed = await runSmoke({
      run: (args) =>
        args[0] === "quote"
          ? Promise.resolve({
              code: 1,
              stdout: JSON.stringify({
                ok: false,
                error: { code: "SERVICE_UNAVAILABLE" },
              }),
            })
          : ok({ wallet: { name: "default" } }),
      log: (line) => lines.push(line),
    });
    expect(passed).toBe(false);
    expect(lines.join("\n")).toContain("SERVICE_UNAVAILABLE");
  });
});
