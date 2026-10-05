import { describe, expect, it } from "vitest";

import { checkPullRequest } from "./pull-request.ts";

const TRAILER = ["Co-Authored", "-By: Claude <x@example.com>"].join("");

describe("a pull request about to become one commit on main", () => {
  it.each([
    "feat: quote a pair",
    "fix(order): cancel an expired order",
    "feat!: rename --ttl to --lifetime",
    "ci: one required check",
    'Revert "feat: quote a pair"',
  ])("accepts the conventional title `%s`", (title) => {
    expect(checkPullRequest(title, "")).toEqual([]);
  });

  it.each([
    "Add quote command",
    "feature: quote",
    "feat:quote",
    "feat(Order): x",
    "feat: ",
  ])("rejects the title `%s`", (title) => {
    expect(checkPullRequest(title, "")).toHaveLength(1);
  });

  it("rejects a description that credits an AI tool, since it becomes the commit message", () => {
    expect(checkPullRequest("fix: x", `Done.\n\n${TRAILER}`)).toEqual([
      expect.stringContaining("credited as an author"),
    ]);
  });
});
