import { describe, expect, test } from "bun:test";
import {
  bunTestsFailed,
  digestBunTestOutput,
  failingTestLines,
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

  test("keeps ANSI-stripped expected/received lines and error blocks", () => {
    const output = [
      "\u001B[31m(fail) cli index > runs help command\u001B[0m",
      "\u001B[31merror: CLI help failed.\u001B[0m",
      "--- stdout ---",
      "Available commands:",
      "--- stderr ---",
      "Unknown command: src/cli/index.ts",
      "      at <unknown> (tests/unit/cli/index.test.ts:8:24)",
      "(pass) next test",
      "\u001B[32mExpected:\u001B[0m 0",
      "\u001B[31mReceived:\u001B[0m 1",
    ].join("\n");

    const digest = digestBunTestOutput(output);
    expect(digest).toContain("(fail) cli index > runs help command");
    expect(digest).toContain("error: CLI help failed.");
    expect(digest).toContain("--- stdout ---");
    expect(digest).toContain("Unknown command: src/cli/index.ts");
    expect(digest).toContain("Expected: 0");
    expect(digest).toContain("Received: 1");
    expect(digest).not.toContain("\u001B[");

    const details = failingTestLines(output);
    expect(details).toContain("(fail) cli index > runs help command");
    expect(details).toContain("--- stderr ---");
    expect(details).not.toContain("(pass) next test");
  });
});
