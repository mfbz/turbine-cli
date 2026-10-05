import { describe, expect, it } from "vitest";

import { createCursor } from "./cursor.ts";

describe("the cursor", () => {
  it("is given back on an interrupt only while it is hidden", () => {
    let out = "";
    const cursor = createCursor((t) => (out += t));
    cursor.restore();
    expect(out).toBe("");
    cursor.hide();
    cursor.restore();
    expect(out).toBe("\u001b[?25l\u001b[?25h");
    cursor.restore();
    expect(out).toBe("\u001b[?25l\u001b[?25h");
  });

  it("knows when it is already shown", () => {
    let out = "";
    const cursor = createCursor((t) => (out += t));
    cursor.hide();
    cursor.show();
    cursor.restore();
    expect(out).toBe("\u001b[?25l\u001b[?25h");
  });
});
