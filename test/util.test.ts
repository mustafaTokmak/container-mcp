import { describe, test, expect } from "vitest";
import { ok, fail } from "../src/tools/util.js";

describe("tool result helpers", () => {
  test("ok wraps text content", () => {
    expect(ok("hello")).toEqual({ content: [{ type: "text", text: "hello" }] });
  });

  test("fail wraps an Error message and sets isError", () => {
    const res = fail(new Error("boom"));
    expect(res.isError).toBe(true);
    expect(res.content).toEqual([{ type: "text", text: "boom" }]);
  });

  test("fail stringifies non-Error values", () => {
    expect(fail("oops").content[0]).toEqual({ type: "text", text: "oops" });
  });
});
