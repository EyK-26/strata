import { describe, expect, test } from "bun:test";
import { runWithRequestMeta } from "@getstrata/core/http/requestMetaContext";
import { isPrivateAddress, readClientIp, trustForwardedFor } from "../../src/core/http/clientIp";

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

  test("takes the rightmost public x-forwarded-for hop when trust is enabled", () => {
    const request = new Request("http://example.test/", {
      headers: {
        "x-forwarded-for": "203.0.113.10, 10.0.0.1",
        "x-real-ip": "198.51.100.20",
      },
    });

    expect(readClientIp(request, { TRUST_FORWARDED_FOR: "true" })).toBe("203.0.113.10");
    expect(trustForwardedFor({ TRUST_FORWARDED_FOR: "true" })).toBe(true);
  });

  test("a client cannot pick its own throttle key by prepending to x-forwarded-for", () => {
    const request = new Request("http://example.test/", {
      headers: { "x-forwarded-for": "1.2.3.4, 203.0.113.10" },
    });

    expect(readClientIp(request, { TRUST_FORWARDED_FOR: "true" })).toBe("203.0.113.10");
  });

  test("uses the rightmost hop when every hop is private", () => {
    const request = new Request("http://example.test/", {
      headers: { "x-forwarded-for": "192.168.1.20, 10.0.0.5" },
    });

    expect(readClientIp(request, { TRUST_FORWARDED_FOR: "true" })).toBe("10.0.0.5");
  });

  test("falls back to x-real-ip when x-forwarded-for is absent", () => {
    const request = new Request("http://example.test/", {
      headers: {
        "x-real-ip": "198.51.100.20",
      },
    });

    expect(readClientIp(request, { TRUST_FORWARDED_FOR: "true" })).toBe("198.51.100.20");
  });

  test("falls back to the socket address recorded by the server", async () => {
    const request = new Request("http://example.test/");

    await runWithRequestMeta({ ipAddress: "198.51.100.7", userAgent: null }, () => {
      expect(readClientIp(request, {})).toBe("198.51.100.7");
      expect(readClientIp(request, { TRUST_FORWARDED_FOR: "true" })).toBe("198.51.100.7");
    });
  });

  test("recognises private, loopback, and link-local addresses", () => {
    for (const ip of [
      "127.0.0.1",
      "::1",
      "::ffff:10.1.2.3",
      "172.16.0.9",
      "192.168.0.1",
      "169.254.1.1",
      "fd12::1",
      "fe80::1",
    ]) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
    for (const ip of ["203.0.113.10", "8.8.8.8", "172.32.0.1", "2001:db8::1"]) {
      expect(isPrivateAddress(ip)).toBe(false);
    }
  });
});
