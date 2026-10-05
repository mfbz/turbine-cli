import { describe, expect, it } from "vitest";

import { CliError, toErrorReport } from "./errors.ts";

describe("toErrorReport", () => {
  it("keeps our own errors as they are", () => {
    const error = new CliError("KEY_INVALID", "The key isn't valid.", {
      hint: "Use 64 hex digits.",
    });
    expect(toErrorReport(error, false)).toEqual({
      code: "KEY_INVALID",
      message: "The key isn't valid.",
      hint: "Use 64 hex digits.",
      exitCode: 1,
    });
  });

  it("carries the usage exit code", () => {
    const error = new CliError("USAGE", "Unknown flag.", { exitCode: 2 });
    expect(toErrorReport(error, false).exitCode).toBe(2);
  });

  it("explains a Turbine API error in plain words, keeping its code", () => {
    const sdkError = {
      code: "SERVICE_UNAVAILABLE",
      message: "Turbine is currently unavailable. Try again later.",
    };
    const report = toErrorReport(sdkError, false);
    expect(report.code).toBe("SERVICE_UNAVAILABLE");
    expect(report.message).toMatch(/unavailable/i);
    expect(report.hint).toBeDefined();
    expect(report.exitCode).toBe(1);
  });

  it("passes through an unknown Turbine code with its own message", () => {
    expect(
      toErrorReport({ code: "SOMETHING_NEW", message: "It broke." }, false)
    ).toEqual({ code: "SOMETHING_NEW", message: "It broke.", exitCode: 1 });
  });

  it("reports anything else as unexpected, with the stack only in debug mode", () => {
    const plain = toErrorReport(new Error("boom"), false);
    expect(plain).toEqual({
      code: "UNEXPECTED",
      message: "boom",
      hint: "Run again with --debug for details.",
      exitCode: 1,
    });
    expect(toErrorReport(new Error("boom"), true).stack).toContain("boom");
    expect(toErrorReport("a string", false).message).toBe("a string");
  });
});
