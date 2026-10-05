import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { readRepoFile } from "./repo.ts";

type Workflow = { on: Record<string, { types?: string[] } | null> };

const ci = parse(readRepoFile(".github", "workflows", "ci.yml")) as Workflow;

describe("the CI workflow", () => {
  it("runs again when a pull request's title or description is edited (they become the squash commit)", () => {
    expect(ci.on.pull_request?.types).toEqual(
      expect.arrayContaining(["opened", "synchronize", "reopened", "edited"])
    );
  });
});
