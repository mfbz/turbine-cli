import { describe, expect, it } from "vitest";

import { parseFrontmatter, validateSkill } from "./skills.ts";

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
