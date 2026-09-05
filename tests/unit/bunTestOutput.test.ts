import { describe, expect, test } from "bun:test";
import {
  bunTestsFailed,
  digestBunTestOutput,
  parseLastFailCount,
} from "../../scripts/bun-test-output.ts";

describe("bun test output helpers", () => {
  test("reads the last fail count and ignores mail HTML", () => {
    const output = [
      "(pass) example",
      '{"level":"info","channel":"mail","html":"<!DOCTYPE html>\\n 0 fail\\n"}',
      " 151 pass",
      " 0 fail",
      " 400 expect() calls",
    ].join("\n");

    expect(parseLastFailCount(output)).toBe(0);
    expect(bunTestsFailed(output, 0)).toBe(false);
    const digest = digestBunTestOutput(output);
    expect(digest).toContain("0 fail");
    expect(digest).not.toContain("<!DOCTYPE html>");
    expect(digest).toContain("(pass) example");
  });

  test("treats a missing summary or nonzero exit as failure", () => {
    expect(bunTestsFailed("no summary here", 0)).toBe(true);
    expect(bunTestsFailed(" 1 fail\n", 0)).toBe(true);
    expect(bunTestsFailed(" 0 fail\n", 1)).toBe(true);
  });
});
