import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  loginRedirectLocation,
  safeInternalRedirectPath,
  sanitizeInternalPath,
} from "@getstrata/core/http/safeInternalPath";
import {
  assertValidSignature,
  hasValidSignature,
  signedUrl,
  temporarySignedUrl,
} from "@getstrata/core/http/signedUrl";

const SECRET_KEYS = ["SIGNED_URL_SECRET", "APP_KEY", "SESSION_SECRET"] as const;
const previous: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of SECRET_KEYS) {
    previous[key] = process.env[key];
  }
  process.env.SESSION_SECRET = "signed-url-test-secret-value-32-chars";
  process.env.APP_URL = "https://app.example.com";
});

afterEach(() => {
  for (const key of SECRET_KEYS) {
    if (previous[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous[key];
    }
  }
});

describe("sanitizeInternalPath rejects open redirects", () => {
  const hostile = [
    "//evil.com",
    "///evil.com",
    "/\\evil.com",
    "\\\\evil.com",
    "https://evil.com",
    "http://evil.com",
    "HTTPS://evil.com",
    "javascript:alert(1)",
    "//evil.com/%2e%2e",
    "/%2f%2fevil.com",
    "/%5c%5cevil.com",
    "https:/evil.com",
    "//%65vil.com",
    " //evil.com",
    "%2F%2Fevil.com",
  ];

  for (const target of hostile) {
    test(`falls back for ${JSON.stringify(target)}`, () => {
      expect(sanitizeInternalPath(target)).toBe("/");
    });
  }

  test("honours a caller supplied fallback", () => {
    expect(sanitizeInternalPath("//evil.com", "/dashboard")).toBe("/dashboard");
  });

  test("keeps genuine internal paths intact", () => {
    for (const target of ["/", "/dashboard", "/a/b?c=1", "/x?next=%2Fy"]) {
      expect(sanitizeInternalPath(target)).toBe(target);
    }
  });

  test("malformed percent-encoding falls back instead of throwing", () => {
    expect(sanitizeInternalPath("/%")).toBe("/");
    expect(sanitizeInternalPath("/%zz")).toBe("/");
  });
});

describe("safeInternalRedirectPath", () => {
  test("returns the path and query of the current request", () => {
    const request = new Request("https://app.example.com/orders?page=2");
    expect(safeInternalRedirectPath(request)).toBe("/orders?page=2");
  });

  test("loginRedirectLocation encodes the target so it cannot break out", () => {
    const request = new Request("https://app.example.com/orders?page=2");
    expect(loginRedirectLocation(request)).toBe("/login?redirect=%2Forders%3Fpage%3D2");
  });
});

describe("signed URLs", () => {
  test("a freshly signed URL verifies", () => {
    expect(hasValidSignature(signedUrl("/invoices/9"))).toBe(true);
  });

  test("a tampered path does not verify", () => {
    const signed = signedUrl("/invoices/9");
    expect(hasValidSignature(signed.replace("/invoices/9", "/invoices/10"))).toBe(false);
  });

  test("a tampered query value does not verify", () => {
    const signed = signedUrl("/invoices", { id: "9" });
    expect(hasValidSignature(signed.replace("id=9", "id=10"))).toBe(false);
  });

  test("a stripped signature does not verify", () => {
    expect(hasValidSignature("/invoices/9")).toBe(false);
  });

  test("a forged signature does not verify", () => {
    expect(hasValidSignature("/invoices/9?signature=deadbeef")).toBe(false);
  });

  test("query parameter order does not change the outcome", () => {
    const signed = new URL(signedUrl("/report", { b: "2", a: "1" }), "https://app.example.com");
    const reordered = new URL("https://app.example.com/report");
    const signature = signed.searchParams.get("signature") ?? "";

    reordered.searchParams.set("b", "2");
    reordered.searchParams.set("a", "1");
    reordered.searchParams.set("signature", signature);

    expect(hasValidSignature(reordered)).toBe(true);
  });

  test("an unexpired temporary URL verifies", () => {
    expect(hasValidSignature(temporarySignedUrl("/invoices/9", 60))).toBe(true);
  });

  test("an expired temporary URL does not verify", () => {
    const signed = new URL(temporarySignedUrl("/invoices/9", 60), "https://app.example.com");
    const past = Math.floor(Date.now() / 1000) - 1;
    signed.searchParams.set("expires", String(past));

    expect(hasValidSignature(signed)).toBe(false);
  });

  test("a non-numeric expiry does not verify", () => {
    const signed = new URL(temporarySignedUrl("/invoices/9", 60), "https://app.example.com");
    signed.searchParams.set("expires", "soon");

    expect(hasValidSignature(signed)).toBe(false);
  });

  test("temporarySignedUrl rejects a non-positive lifetime", () => {
    expect(() => temporarySignedUrl("/x", 0)).toThrow();
    expect(() => temporarySignedUrl("/x", -1)).toThrow();
  });

  test("a signature made with a different secret does not verify", () => {
    const signed = signedUrl("/invoices/9");
    process.env.SESSION_SECRET = "a-completely-different-secret-value-32";

    expect(hasValidSignature(signed)).toBe(false);
  });

  test("assertValidSignature throws for a bad signature and passes for a good one", () => {
    expect(() => assertValidSignature("/invoices/9?signature=nope")).toThrow();
    expect(() => assertValidSignature(signedUrl("/invoices/9"))).not.toThrow();
  });
});
