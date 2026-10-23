import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertPathUnderRoot, assertUrlPathUnderRoot } from "@getstrata/core/security/safePath";

describe("assertPathUnderRoot", () => {
  const root = mkdtempSync(join(tmpdir(), "strata-safe-path-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

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

  test("decodes URL filenames once without interpreting literal percent escapes twice", () => {
    for (const name of ["café report.txt", "100%.txt", "literal%20.txt", "hash#query?.txt"]) {
      expect(assertUrlPathUnderRoot(root, `/assets/${encodeURIComponent(name)}`)).toBe(
        join(root, "assets", name),
      );
    }
    expect(assertUrlPathUnderRoot(root, "/assets/%252e%252e%252fsecret")).toBe(
      join(root, "assets", "%2e%2e%2fsecret"),
    );
  });

  test("preserves encoded leading and trailing filename whitespace", () => {
    expect(assertUrlPathUnderRoot(root, "/%20report.txt%20")).toBe(join(root, " report.txt "));
  });

  test("rejects encoded traversal, null bytes and malformed URI sequences", () => {
    for (const value of [
      "/%2e%2e%2fsecret",
      "/a/%2e%2e%2f%2e%2e%2fsecret",
      "/a%00b",
      "/%",
      "/%FF",
    ]) {
      expect(() => assertUrlPathUnderRoot(root, value)).toThrow();
    }
  });

  test("keeps non-URL storage paths literal and retains their existing outer trimming", () => {
    expect(assertPathUnderRoot(root, " literal%20.txt ")).toBe(join(root, "literal%20.txt"));
  });
});
