import { describe, expect, test } from "bun:test";
import {
  loginRedirectLocation,
  safeInternalRedirectPath,
  sanitizeInternalPath,
} from "@getstrata/core/http/safeInternalPath";
import { redirectResponse } from "@getstrata/core/view";

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

describe("redirect parsing boundaries", () => {
  test("rejects URL-parser control characters, including nested redirect targets", () => {
    for (const control of ["\t", "\n", "\r"]) {
      const target = `/${control}/evil.test/path`;
      expect(new URL(target, "https://shop.test").origin).toBe("https://evil.test");
      expect(sanitizeInternalPath(target, "/account")).toBe("/account");
      const location = redirectResponse(target).headers.get("location");
      expect(location).toBe("/");
      expect(new URL(location ?? "", "https://shop.test").origin).toBe("https://shop.test");
      const nested = sanitizeInternalPath(`/login?redirect=${encodeURIComponent(target)}`);
      expect(new URL(nested, "https://shop.test").searchParams.get("redirect")).toBe("/");
    }
  });

  test("preserves repeated filters and sanitizes every repeated redirect", () => {
    const path = sanitizeInternalPath(
      "/orders?status=pending&status=paid&next=%2Faccount&next=%2F%2Fevil.test",
    );
    const url = new URL(path, "https://shop.test");
    expect(url.searchParams.getAll("status")).toEqual(["pending", "paid"]);
    expect(url.searchParams.getAll("next")).toEqual(["/account", "/"]);
  });
});
