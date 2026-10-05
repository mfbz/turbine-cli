import { describe, expect, it } from "vitest";

import {
  cliSurface,
  parseFrontmatter,
  validateSkill,
  unknownCommands,
  unknownFlags,
} from "./skills.ts";

function skill(frontmatter: string, body = "Do the thing.\n"): string {
  return `---\n${frontmatter}\n---\n\n${body}`;
}

describe("parseFrontmatter", () => {
  it("parses a description that contains a colon when quoted", () => {
    const parsed = parseFrontmatter(
      skill('name: demo\ndescription: "Use when: things happen"')
    );
    expect(parsed?.data.description).toBe("Use when: things happen");
  });

  it("parses a folded multi-line description", () => {
    const parsed = parseFrontmatter(
      skill("name: demo\ndescription: >-\n  First line\n  second line")
    );
    expect(parsed?.data.description).toBe("First line second line");
  });

  it("returns null without a frontmatter block", () => {
    expect(parseFrontmatter("# just markdown")).toBeNull();
  });
});

describe("validateSkill", () => {
  it("accepts a minimal valid skill", () => {
    expect(
      validateSkill("demo", skill("name: demo\ndescription: Use when testing."))
    ).toEqual([]);
  });

  it("requires the name to match the folder", () => {
    expect(
      validateSkill(
        "demo",
        skill("name: other\ndescription: Use when testing.")
      )
    ).toContain('name "other" must match the folder "demo"');
  });

  it("rejects names that are not lowercase-hyphenated", () => {
    expect(
      validateSkill("Demo_1", skill("name: Demo_1\ndescription: x"))
    ).toContain(
      'name "Demo_1" must be lowercase letters, digits and single hyphens'
    );
  });

  it("requires a description", () => {
    expect(validateSkill("demo", skill("name: demo"))).toContain(
      "description is required"
    );
  });

  it("rejects a description over 1024 characters", () => {
    expect(
      validateSkill(
        "demo",
        skill(`name: demo\ndescription: ${"x".repeat(1025)}`)
      )
    ).toContain("description is 1025 characters; the limit is 1024");
  });

  it("rejects keys outside the Agent Skills standard", () => {
    expect(
      validateSkill(
        "demo",
        skill("name: demo\ndescription: x\nuser-invocable: true")
      )
    ).toContain('unknown frontmatter key "user-invocable"');
  });

  it("requires a body", () => {
    expect(
      validateSkill("demo", skill("name: demo\ndescription: x", ""))
    ).toContain("the skill body is empty");
  });
});

describe("checking a skill against the CLI", () => {
  const source = `
    program.option("--json", "x").option("-y, --yes", "x")
      .option(
        "--dry-run", "x")
    program.command("quote").requiredOption("--spread <bps>", "x");
    const order = program.command("order");
    order.command("cancel");
  `;

  it("reads the CLI's flags and commands from its source", () => {
    const surface = cliSurface(source);
    expect([...surface.flags].sort()).toEqual([
      "--dry-run",
      "--json",
      "--spread",
      "--yes",
    ]);
    expect([...surface.commands].sort()).toEqual(["cancel", "order", "quote"]);
  });

  it("flags a truncated or misspelled flag, not only a missing one", () => {
    const surface = cliSurface(source);
    expect(
      unknownFlags("use --dry, --json and --dry-run, never --yess", surface)
    ).toEqual(["--dry", "--yess"]);
  });

  it("flags a command or subcommand that doesn't exist, in code spans only", () => {
    const surface = cliSurface(source);
    expect(
      unknownCommands(
        "Run `turbine quote 1 WETH`, `turbine order cancel 0x…`, `turbine order wach 0x…` and `turbine qoute`; the turbine command line is fine.",
        surface
      )
    ).toEqual(["turbine order wach", "turbine qoute"]);
  });
});
