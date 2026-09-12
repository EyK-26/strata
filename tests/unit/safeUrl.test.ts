import { afterEach, describe, expect, test } from "bun:test";
import {
  assertSafeOutboundUrl,
  assertSafeOutboundUrlResolved,
  isBlockedHostname,
  resetDnsLookupForTests,
  setDnsLookupForTests,
} from "@getstrata/core/security/safeUrl";

afterEach(() => {
  resetDnsLookupForTests();
});

describe("assertSafeOutboundUrl", () => {
  test("accepts public https URLs", () => {
    const parsed = assertSafeOutboundUrl("https://hooks.example.com/strata");

    expect(parsed.hostname).toBe("hooks.example.com");
  });

  test("rejects localhost and private networks", () => {
    expect(() => assertSafeOutboundUrl("https://127.0.0.1/hook")).toThrow(/blocked host/);
    expect(() => assertSafeOutboundUrl("https://localhost/hook")).toThrow(/blocked host/);
    expect(() => assertSafeOutboundUrl("https://10.0.0.5/hook")).toThrow(/blocked host/);
    expect(() => assertSafeOutboundUrl("https://169.254.169.254/latest/meta-data")).toThrow(
      /blocked host/,
    );
    expect(() => assertSafeOutboundUrl("https://100.64.0.1/hook")).toThrow(/blocked host/);
    expect(() => assertSafeOutboundUrl("https://198.18.0.1/hook")).toThrow(/blocked host/);
    expect(() => assertSafeOutboundUrl("https://2130706433/hook")).toThrow(/blocked host/);
  });

  test("rejects non-https URLs by default", () => {
    expect(() => assertSafeOutboundUrl("http://hooks.example.com/strata")).toThrow(/HTTPS/);
  });

  test("allows http URLs outside production when configured", () => {
    const parsed = assertSafeOutboundUrl("http://hooks.example.com/strata", {
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

describe("assertSafeOutboundUrlResolved", () => {
  test("skips DNS lookup when resolveDns is false", async () => {
    await expect(
      assertSafeOutboundUrlResolved("https://example.com/hook", { resolveDns: false }),
    ).resolves.toMatchObject({ hostname: "example.com" });
  });

  test("rejects hostnames that resolve to private addresses", async () => {
    setDnsLookupForTests(async () => [{ address: "10.0.0.8", family: 4 }]);

    await expect(
      assertSafeOutboundUrlResolved("https://public.example.com/hook", {
        allowHttp: true,
        resolveDns: true,
      }),
    ).rejects.toThrow(/blocked host/);
  });

  test("accepts hostnames that resolve to public addresses", async () => {
    setDnsLookupForTests(async () => [{ address: "8.8.8.8", family: 4 }]);

    await expect(
      assertSafeOutboundUrlResolved("https://public.example.com/hook", {
        allowHttp: true,
        resolveDns: true,
      }),
    ).resolves.toMatchObject({ hostname: "public.example.com" });
  });

  test("treats DNS resolution failures as a blocked host", async () => {
    setDnsLookupForTests(async () => {
      throw new Error("ENOTFOUND");
    });
    await expect(assertSafeOutboundUrlResolved("https://missing.example.com/hook")).rejects.toThrow(
      /blocked host/,
    );
  });

  test("rejects empty DNS results and skips lookup for private allowlists", async () => {
    setDnsLookupForTests(async () => []);
    await expect(assertSafeOutboundUrlResolved("https://public.example.com/hook")).rejects.toThrow(
      /blocked host/,
    );
    await expect(
      assertSafeOutboundUrlResolved("https://10.0.0.8/hook", { allowPrivate: true }),
    ).resolves.toMatchObject({ hostname: "10.0.0.8" });
  });

  test("resetDnsLookupForTests restores the default resolver", () => {
    setDnsLookupForTests(async () => []);
    resetDnsLookupForTests();
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
    expect(isBlockedHostname("100.64.1.2")).toBe(true);
    expect(isBlockedHostname("2130706433")).toBe(true);
    expect(isBlockedHostname("0x7f.0.0.1")).toBe(true);
    expect(isBlockedHostname("012.0.0.1")).toBe(true);
    expect(isBlockedHostname("198.19.1.1")).toBe(true);
    expect(isBlockedHostname("fe80::1")).toBe(true);
    expect(isBlockedHostname("fc00::1")).toBe(true);
    expect(isBlockedHostname("ff00::1")).toBe(true);
    expect(isBlockedHostname("::")).toBe(true);
    expect(isBlockedHostname("::1")).toBe(true);
    expect(isBlockedHostname("0:0:0:0:0:0:0:1")).toBe(true);
    expect(isBlockedHostname("::ffff:10.0.0.1")).toBe(true);
    expect(isBlockedHostname("::ffff:8.8.8.8")).toBe(false);
    expect(isBlockedHostname("2001:4860:4860::8888")).toBe(false);
    expect(isBlockedHostname("fe80::1%eth0")).toBe(true);
    expect(isBlockedHostname("1:2:3:4:5:6:7:8:9")).toBe(true);
    expect(isBlockedHostname("1::2::3")).toBe(true);
    expect(isBlockedHostname("gggg::1")).toBe(true);
    expect(isBlockedHostname("1:2:3:4:5:6:7:zzzz")).toBe(true);
    expect(isBlockedHostname("256.1.1.1")).toBe(true);
    expect(isBlockedHostname("08.1.1.1")).toBe(true);
    expect(isBlockedHostname("0x100.1.1.1")).toBe(true);
    expect(isBlockedHostname("4294967296")).toBe(true);
    expect(isBlockedHostname("10..0.1")).toBe(true);
    expect(isBlockedHostname("0400.1.1.1")).toBe(true);
    expect(isBlockedHostname("::ffff:012.0.0.1")).toBe(true);
    expect(isBlockedHostname("::ffff:0x7f.0.0.1")).toBe(true);
    expect(isBlockedHostname("::ffff:08.1.1.1")).toBe(true);
    expect(isBlockedHostname("::ffff:0x100.1.1.1")).toBe(true);
    expect(isBlockedHostname("::ffff:0400.1.1.1")).toBe(true);
    expect(isBlockedHostname("::ffff:10..0.1")).toBe(true);
    expect(isBlockedHostname("::ffff:1.2.3")).toBe(true);
    expect(isBlockedHostname("::ffff:10.0.0.abc")).toBe(true);
    expect(isBlockedHostname("::ffff:256.1.1.1")).toBe(true);
    expect(isBlockedHostname("::ffff:010.010.010.010")).toBe(false);
    expect(isBlockedHostname("::ffff:999.1.1.1")).toBe(true);
    expect(isBlockedHostname("1:2:3:4:5:6:7::8:9")).toBe(true);
    expect(isBlockedHostname("1::gggg")).toBe(true);
    expect(isBlockedHostname("1:2:3:4:5:6:7:8g")).toBe(true);
  });
});
