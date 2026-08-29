import { describe, expect, test } from "bun:test";
import {
  loginRedirectLocation,
  safeInternalRedirectPath,
  sanitizeInternalPath,
} from "@getstrata/core/http/safeInternalPath";

describe("sanitizeInternalPath", () => {
  test("keeps same-origin paths and query strings", () => {
    expect(sanitizeInternalPath("/forum?page=2")).toBe("/forum?page=2");
    expect(sanitizeInternalPath("/login")).toBe("/login");
  });

  test("rejects protocol-relative, scheme, and backslash targets", () => {
    expect(sanitizeInternalPath("//evil.test/phish")).toBe("/");
    expect(sanitizeInternalPath("/https://evil.test")).toBe("/");
    expect(sanitizeInternalPath("/ok\\evil")).toBe("/");
    expect(sanitizeInternalPath("https://evil.test")).toBe("/");
  });
});

describe("loginRedirectLocation", () => {
  test("preserves pathname and search", () => {
    const request = new Request("http://example.test/forum?page=2");

    expect(safeInternalRedirectPath(request)).toBe("/forum?page=2");
    expect(loginRedirectLocation(request)).toBe("/login?redirect=%2Fforum%3Fpage%3D2");
  });
});
