import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { readRepoFile } from "./repo.ts";

type Step = { run?: string };
type Workflow = {
  on: Record<string, { types?: string[] } | null>;
  jobs: Record<string, { steps?: Step[] }>;
};

const ci = parse(readRepoFile(".github", "workflows", "ci.yml")) as Workflow;

// The one required check: it passes only if every job it waits for passed or was skipped.
function gate(results: string): number | null {
  const script = ci.jobs.ci?.steps?.find((step) => step.run)?.run ?? "";
  return spawnSync("bash", ["-e", "-c", script], {
    env: { ...process.env, RESULTS: results },
  }).status;
}

describe("the CI workflow", () => {
  it("runs again when a pull request's title or description is edited (they become the squash commit)", () => {
    expect(ci.on.pull_request?.types).toEqual(
      expect.arrayContaining(["opened", "synchronize", "reopened", "edited"])
    );
  });

  it("passes the required check only when every job passed or was skipped", () => {
    expect(gate("success success success")).toBe(0);
    expect(gate("success skipped success")).toBe(0);
    // Jobs that never got a runner end as "abandoned": that is not a pass.
    for (const bad of ["failure", "cancelled", "abandoned", "timed_out"])
      expect(gate(`success ${bad} success`), bad).not.toBe(0);
    expect(gate(""), "no results").not.toBe(0);
  });
});
