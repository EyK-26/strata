import { describe, expect, test } from "bun:test";
import { readIntendedUrl } from "@getstrata/core/auth/intendedUrlCookie";
import { createFlashCookie, pullFlash } from "@getstrata/core/http/flashSession";

const intended = { cookieName: "return_to", ttlSeconds: 60, production: false };
const flash = {
  cookieName: "notice",
  secret: "test-cookie-secret-at-least-32-characters",
  production: false,
};

for (const native of [false, true]) {
  describe(native ? "Bun cookie map" : "standard Request cookie header", () => {
    function request(cookie: string): Request {
      const value = new Request("https://shop.test", { headers: { cookie } });
      if (native) Object.defineProperty(value, "cookies", { value: new Bun.CookieMap(cookie) });
      return value;
    }
    for (const malformed of ["%", "%E0%A4", "%GG"]) {
      test(`malformed optional cookies ${malformed} do not throw`, () => {
        const req = request(`return_to=${malformed}; notice=${malformed}`);
        expect(readIntendedUrl(req, intended)).toBeNull();
        expect(pullFlash(req, flash)).toBeNull();
      });
    }
    test("valid intended paths and signed messages still round-trip", () => {
      const message = { level: "success" as const, message: "Saved ✓" };
      const signed = createFlashCookie(message, flash).split(";")[0];
      const req = request(`return_to=${encodeURIComponent("/orders?status=paid")}; ${signed}`);
      expect(readIntendedUrl(req, intended)).toBe("/orders?status=paid");
      expect(pullFlash(req, flash)).toEqual(message);
    });
    test("an invalid optional cookie does not discard a valid sibling", () => {
      const message = { level: "info" as const, message: "Saved" };
      const signed = createFlashCookie(message, flash).split(";")[0];
      const req = request(`return_to=%; ${signed}`);
      expect(readIntendedUrl(req, intended)).toBeNull();
      expect(pullFlash(req, flash)).toEqual(message);
      const other = request("return_to=%2Forders; notice=%");
      expect(pullFlash(other, flash)).toBeNull();
      expect(readIntendedUrl(other, intended)).toBe("/orders");
    });
  });
}
