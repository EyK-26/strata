import { describe, expect, test } from "bun:test";
import { assertSafeOutboundUrl, isBlockedHostname } from "../../src/core/security/safeUrl";

describe("assertSafeOutboundUrl", () => {
  test("accepts public https URLs", () => {
    const parsed = assertSafeOutboundUrl("https://hooks.example.com/workhub");

    expect(parsed.hostname).toBe("hooks.example.com");
  });

  test("rejects localhost and private networks", () => {
    expect(() => assertSafeOutboundUrl("https://127.0.0.1/hook")).toThrow(/blocked host/);
    expect(() => assertSafeOutboundUrl("https://localhost/hook")).toThrow(/blocked host/);
    expect(() => assertSafeOutboundUrl("https://10.0.0.5/hook")).toThrow(/blocked host/);
    expect(() => assertSafeOutboundUrl("https://169.254.169.254/latest/meta-data")).toThrow(
      /blocked host/,
    );
  });

  test("rejects non-https URLs by default", () => {
    expect(() => assertSafeOutboundUrl("http://hooks.example.com/workhub")).toThrow(/HTTPS/);
  });

  test("allows http URLs outside production when configured", () => {
    const parsed = assertSafeOutboundUrl("http://hooks.example.com/workhub", {
      allowHttp: true,
    });

    expect(parsed.protocol).toBe("http:");
  });

  test("rejects invalid urls, credentials, and blocked networks", () => {
    expect(() => assertSafeOutboundUrl("not-a-url")).toThrow("Webhook URL is invalid.");
    expect(() => assertSafeOutboundUrl("https://user:pass@hooks.example.com/hook")).toThrow(
      /credentials/,
    );
    expect(() => assertSafeOutboundUrl("https://192.168.1.10/hook")).toThrow(/blocked host/);
    expect(() => assertSafeOutboundUrl("https://172.16.0.2/hook")).toThrow(/blocked host/);
    expect(() => assertSafeOutboundUrl("https://0.0.0.0/hook")).toThrow(/blocked host/);
    expect(() => assertSafeOutboundUrl("https://[::1]/hook")).toThrow(/blocked host/);
  });
});

describe("isBlockedHostname", () => {
  test("flags metadata and internal host suffixes", () => {
    expect(isBlockedHostname("metadata.google.internal")).toBe(true);
    expect(isBlockedHostname("service.local")).toBe(true);
    expect(isBlockedHostname("")).toBe(true);
    expect(isBlockedHostname("0.1.2.3")).toBe(true);
    expect(isBlockedHostname("8.8.8.8")).toBe(false);
    expect(isBlockedHostname("hooks.example.com")).toBe(false);
  });
});
