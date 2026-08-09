import { describe, expect, test } from "bun:test";
import { readBunRequestCookie, readRequestCookie } from "../../src/core/http/cookies";

describe("readRequestCookie", () => {
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
