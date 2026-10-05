import { describe, expect, it } from "vitest";

import { readRepoFile } from "./repo.ts";

describe("public docs", () => {
  it.each(["README.md", "TURBINE-CLI.md"])(
    "%s says this is an unofficial tool",
    (file) => {
      expect(readRepoFile(file)).toMatch(/unofficial/i);
    }
  );

  it.each([
    /playground is the default/i,
    /--dry-run/,
    /never sign silently/i,
    /--network mainnet/,
  ])("TURBINE-CLI.md keeps the binding safety rule %s", (rule) => {
    expect(readRepoFile("TURBINE-CLI.md")).toMatch(rule);
  });

  it.each(["AGENTS.md", "SECURITY.md"])(
    "%s carries the safety rules agents and reporters rely on",
    (file) => {
      const text = readRepoFile(file);
      expect(text).toMatch(/playground/i);
      expect(text).toMatch(/dry-run/i);
    }
  );
});
