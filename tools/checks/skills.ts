import { parse } from "yaml";

type Frontmatter = { data: Record<string, unknown>; body: string };
type CliSurface = { flags: Set<string>; commands: Set<string> };

// The portable subset of the Agent Skills standard; tool-specific keys would hide skills from other agents.
const ALLOWED_KEYS = new Set([
  "name",
  "description",
  "license",
  "compatibility",
  "metadata",
  "allowed-tools",
]);
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_NAME = 64;
const MAX_DESCRIPTION = 1024;
// An option's definition string: "--json", "-y, --yes", "--spread <bps>".
const OPTION_DEFINITION = /"(?:-[a-z], )?(--[a-z][a-z-]*)(?: <[^>]+>)?"/g;
const COMMAND_DEFINITION = /\.command\("([a-z]+)"/g;
const FLAG_USE = /(?<![\w-])--[a-z][a-z-]*/g;
const CODE_SPAN = /`([^`]+)`/g;
// Commands that only group others: what follows them must be a command too.
const GROUPS = new Set(["order", "wallet"]);
const BLOCK = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

function parseFrontmatter(text: string): Frontmatter | null {
  const match = BLOCK.exec(text);
  if (!match) return null;
  const data: unknown = parse(match[1] ?? "");
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return null;
  }
  return { data: data as Record<string, unknown>, body: match[2] ?? "" };
}

function validateSkill(folder: string, text: string): string[] {
  const parsed = parseFrontmatter(text);
  if (!parsed) return ["missing or invalid YAML frontmatter block"];
  const problems: string[] = [];
  const { data, body } = parsed;
  const { name, description } = data;
  if (typeof name !== "string" || name.length === 0) {
    problems.push("name is required");
  } else {
    if (!NAME.test(name) || name.length > MAX_NAME) {
      problems.push(
        `name "${name}" must be lowercase letters, digits and single hyphens`
      );
    }
    if (name !== folder) {
      problems.push(`name "${name}" must match the folder "${folder}"`);
    }
  }
  if (typeof description !== "string" || description.trim().length === 0) {
    problems.push("description is required");
  } else if (description.length > MAX_DESCRIPTION) {
    problems.push(
      `description is ${description.length} characters; the limit is ${MAX_DESCRIPTION}`
    );
  }
  for (const key of Object.keys(data)) {
    if (!ALLOWED_KEYS.has(key)) {
      problems.push(`unknown frontmatter key "${key}"`);
    }
  }
  if (body.trim().length === 0) problems.push("the skill body is empty");
  return problems;
}

/** The flags and command names a CLI's source defines, for checking docs against it. */
function cliSurface(source: string): CliSurface {
  return {
    flags: new Set(
      [...source.matchAll(OPTION_DEFINITION)].map((m) => m[1] ?? "")
    ),
    commands: new Set(
      [...source.matchAll(COMMAND_DEFINITION)].map((m) => m[1] ?? "")
    ),
  };
}

function unknownFlags(text: string, surface: CliSurface): string[] {
  return [...text.matchAll(FLAG_USE)]
    .map((m) => m[0])
    .filter((flag) => !surface.flags.has(flag));
}

// Only in code spans: prose says "the turbine command line" without meaning a command.
function unknownCommands(text: string, surface: CliSurface): string[] {
  const wrong: string[] = [];
  for (const [, span = ""] of text.matchAll(CODE_SPAN)) {
    const words = /^turbine ([a-z]+)(?: ([a-z]+))?/.exec(span);
    if (!words) continue;
    const [, first = "", second = ""] = words;
    const known =
      surface.commands.has(first) &&
      (!GROUPS.has(first) || surface.commands.has(second));
    if (!known)
      wrong.push(
        GROUPS.has(first) ? `turbine ${first} ${second}` : `turbine ${first}`
      );
  }
  return wrong;
}

export {
  cliSurface,
  parseFrontmatter,
  unknownCommands,
  unknownFlags,
  validateSkill,
};
export type { CliSurface, Frontmatter };
