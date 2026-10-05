import { existsSync, readdirSync, realpathSync } from "node:fs";

import { describe, expect, it } from "vitest";

import pkg from "../../package.json" with { type: "json" };
import { WARNINGS } from "../../src/commands/place.ts";
import { CATALOGUE } from "../../src/output/errors.ts";
import { readRepoFile, repoPath } from "./repo.ts";
import {
  cliSurface,
  unknownCommands,
  unknownFlags,
  validateSkill,
} from "./skills.ts";

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

  it.each(["AGENTS.md", "CONTRIBUTING.md", "README.md"])(
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

// The skill users give their own agents: it ships with the package, and every error code and flag it
// names has to exist, or an agent would branch on something turbine-cli never says.
describe("the turbine skill", () => {
  const skill = () => readRepoFile("skills", "turbine", "SKILL.md");

  it("is a valid Agent Skill", () => {
    expect(validateSkill("turbine", skill())).toEqual([]);
  });

  it("ships in the npm package", () => {
    expect(pkg.files).toContain("skills/");
  });

  it("names only error codes, warnings and environment variables turbine-cli has", () => {
    const env = readRepoFile("src", "config", "env.ts");
    const named = [...skill().matchAll(/`([A-Z][A-Z0-9_]{2,})`/g)]
      .map((match) => match[1] ?? "")
      .filter(
        (code) =>
          !(code in CATALOGUE) &&
          !(code in WARNINGS) &&
          // Environment variables are names too: they must be ones turbine-cli reads.
          !(code.startsWith("TURBINE_") && new RegExp(`\\b${code}:`).test(env))
      );
    expect(named).toEqual([]);
  });

  it("names only flags and commands turbine-cli has, exactly (the README too)", () => {
    const surface = cliSurface(readRepoFile("src", "cli.ts"));
    expect(unknownFlags(skill(), surface)).toEqual([]);
    expect(unknownCommands(skill(), surface)).toEqual([]);
    const readme = readRepoFile("README.md");
    expect(unknownFlags(readme, surface)).toEqual([]);
    expect(unknownCommands(readme, surface)).toEqual([]);
  });
});
