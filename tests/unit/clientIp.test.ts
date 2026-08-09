import { describe, expect, test } from "bun:test";
import { readClientIp, trustForwardedFor } from "../../src/core/http/clientIp";

describe("readClientIp", () => {
  test("ignores forwarded headers unless TRUST_FORWARDED_FOR is true", () => {
    const request = new Request("http://example.test/", {
      headers: {
        "x-forwarded-for": "203.0.113.10, 10.0.0.1",
        "x-real-ip": "198.51.100.20",
      },
    });

    expect(readClientIp(request, {})).toBeUndefined();
    expect(readClientIp(request, { TRUST_FORWARDED_FOR: "false" })).toBeUndefined();
    expect(trustForwardedFor({})).toBe(false);
  });

  test("prefers the first x-forwarded-for hop when trust is enabled", () => {
    const request = new Request("http://example.test/", {
      headers: {
        "x-forwarded-for": "203.0.113.10, 10.0.0.1",
        "x-real-ip": "198.51.100.20",
      },
    });

    expect(readClientIp(request, { TRUST_FORWARDED_FOR: "true" })).toBe("203.0.113.10");
    expect(trustForwardedFor({ TRUST_FORWARDED_FOR: "true" })).toBe(true);
  });

  test("falls back to x-real-ip when x-forwarded-for is absent", () => {
    const request = new Request("http://example.test/", {
      headers: {
        "x-real-ip": "198.51.100.20",
      },
    });

    expect(readClientIp(request, { TRUST_FORWARDED_FOR: "true" })).toBe("198.51.100.20");
  });
});
