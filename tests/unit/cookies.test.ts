import { describe, expect, test } from "bun:test";
import { readBunRequestCookie, readRequestCookie } from "@getstrata/core/http/cookies";

describe("readRequestCookie", () => {
  test("malformed percent encoding is an absent cookie while unrelated valid cookies remain readable", () => {
    for (const value of ["%", "%E0%A4", "%GG"]) {
      const request = new Request("http://example.test", {
        headers: { cookie: `session=${value}; valid=hello%20world` },
      });
      expect(readRequestCookie(request, "session")).toBeNull();
      expect(readRequestCookie(request, "valid")).toBe("hello world");
    }
  });

  test("reads from cookie header", () => {
    const request = new Request("http://example.test/", {
      headers: { cookie: "session=abc123; other=1" },
    });

    expect(readRequestCookie(request, "session")).toBe("abc123");
    expect(readRequestCookie(request, "missing")).toBeNull();
  });

  test("prefers request.cookies when available", () => {
    const request = new Request("http://example.test/") as Request & {
      cookies: { get: (name: string) => string | null };
    };
    request.cookies = {
      get(name: string) {
        return name === "session" ? "from-map" : null;
      },
    };

    expect(readRequestCookie(request, "session")).toBe("from-map");
  });

  test("readBunRequestCookie uses BunRequest cookies first", () => {
    const request = {
      cookies: {
        get(name: string) {
          return name === "csrf" ? "token" : null;
        },
      },
      headers: new Headers({ cookie: "csrf=legacy" }),
    } as never;

    expect(readBunRequestCookie(request, "csrf")).toBe("token");
  });
});
