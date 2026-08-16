import { describe, expect, test } from "bun:test";
import { timingSafeCompareString } from "@getstrata/core/security/timingSafeCompare";

describe("timingSafeCompareString", () => {
  test("returns true for equal strings", () => {
    expect(timingSafeCompareString("secret-token", "secret-token")).toBe(true);
  });

  test("returns false for mismatched strings and lengths", () => {
    expect(timingSafeCompareString("secret-token", "other-token")).toBe(false);
    expect(timingSafeCompareString("short", "longer-value")).toBe(false);
  });
});
