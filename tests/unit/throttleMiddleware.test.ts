import { describe, expect, test } from "bun:test";
import { runWithAuthUser } from "@getstrata/core/auth/authContext";
import { resolveThrottleIdentity } from "@getstrata/core/http/throttleMiddleware";

describe("resolveThrottleIdentity", () => {
  test("prefers token id for bearer-authenticated requests", () => {
    const request = new Request("http://example.test/api/v1/projects");

    const identity = runWithAuthUser({ id: 1, role: "admin", tokenId: 42 }, () =>
      resolveThrottleIdentity(request),
    );

    expect(identity).toBe("token:42");
  });

  test("falls back to user id when no token id is present", () => {
    const request = new Request("http://example.test/api/v1/projects");

    const identity = runWithAuthUser({ id: 7, role: "member" }, () =>
      resolveThrottleIdentity(request),
    );

    expect(identity).toBe("user:7");
  });

  test("uses forwarded ip for guests", () => {
    const request = new Request("http://example.test/api/v1/projects", {
      headers: {
        "x-forwarded-for": "203.0.113.10, 10.0.0.1",
      },
    });

    expect(resolveThrottleIdentity(request)).toBe("203.0.113.10");
  });
});
