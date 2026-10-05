import { existsSync, readdirSync, realpathSync } from "node:fs";

import { describe, expect, it } from "vitest";

import pkg from "../../package.json" with { type: "json" };
import { readRepoFile, repoPath } from "./repo.ts";
import { validateSkill } from "./skills.ts";

const MAX_AGENTS_LINES = 150;
const scripts = Object.keys(pkg.scripts);
const skillFolders = existsSync(repoPath(".agents", "skills"))
  ? readdirSync(repoPath(".agents", "skills"))
  : [];

describe("agent instructions", () => {
  it(`keeps AGENTS.md at ${MAX_AGENTS_LINES} lines or fewer (every agent loads it every session)`, () => {
    expect(readRepoFile("AGENTS.md").split("\n").length).toBeLessThanOrEqual(
      MAX_AGENTS_LINES
    );
  });

  it("CLAUDE.md imports AGENTS.md on its first line", () => {
    expect(readRepoFile("CLAUDE.md").split("\n")[0]).toBe("@AGENTS.md");
  });

  it.each(["AGENTS.md", "CONTRIBUTING.md"])(
    "%s names only npm scripts that exist",
    (file) => {
      const named = [...readRepoFile(file).matchAll(/npm run ([a-z:-]+)/g)]
        .map((match) => match[1] ?? "")
        .filter((name) => !scripts.includes(name));
      expect(named).toEqual([]);
    }
  );
});

describe("skills", () => {
  it("has at least one skill", () => {
    expect(skillFolders.length).toBeGreaterThan(0);
  });

  it.each(skillFolders)(
    ".agents/skills/%s is a valid Agent Skill",
    (folder) => {
      expect(
        validateSkill(
          folder,
          readRepoFile(".agents", "skills", folder, "SKILL.md")
        )
      ).toEqual([]);
    }
  );

  it(".claude/skills points at .agents/skills (on Windows: git config core.symlinks true, then clone again)", () => {
    expect(realpathSync(repoPath(".claude", "skills"))).toBe(
      realpathSync(repoPath(".agents", "skills"))
    );
  });
});
