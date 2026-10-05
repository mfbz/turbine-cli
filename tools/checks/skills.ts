import { parse } from "yaml";

type Frontmatter = { data: Record<string, unknown>; body: string };

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

export { parseFrontmatter, validateSkill };
export type { Frontmatter };
