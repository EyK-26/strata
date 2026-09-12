import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertPathUnderRoot, assertUrlPathUnderRoot } from "@getstrata/core/security/safePath";

describe("assertPathUnderRoot", () => {
  const root = mkdtempSync(join(tmpdir(), "strata-safe-path-"));

  test("resolves a nested path under the root", () => {
    expect(assertPathUnderRoot(root, "notes/hello.txt")).toBe(join(root, "notes/hello.txt"));
  });

  test("rejects parent-directory traversal", () => {
    expect(() => assertPathUnderRoot(root, "../secret")).toThrow(/escapes/);
    expect(() => assertPathUnderRoot(root, "a/../../etc/passwd")).toThrow(/escapes/);
  });

  test("rejects empty and null-byte paths", () => {
    expect(() => assertPathUnderRoot(root, "")).toThrow(/empty/);
    expect(() => assertPathUnderRoot(root, "   ")).toThrow(/empty/);
    expect(() => assertPathUnderRoot(root, "a\0b")).toThrow(/null byte/);
  });

  test("allows the root itself and an absolute path already under the root", () => {
    expect(assertPathUnderRoot(root, ".")).toBe(root);
    expect(assertPathUnderRoot(root, join(root, "notes/hello.txt"))).toBe(
      join(root, "notes/hello.txt"),
    );
  });

  test("rejects an absolute path outside the root", () => {
    expect(() => assertPathUnderRoot(root, "/etc/passwd")).toThrow(/escapes/);
  });

  test("maps a URL pathname onto the document root instead of the filesystem root", () => {
    expect(assertUrlPathUnderRoot(root, "/notes/hello.txt")).toBe(join(root, "notes/hello.txt"));
    expect(() => assertUrlPathUnderRoot(root, "/notes/../../etc/passwd")).toThrow(/escapes/);
  });
});
