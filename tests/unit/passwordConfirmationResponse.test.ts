import { expect, test } from "bun:test";
import { runWithAuthUser } from "@getstrata/core/auth/authContext";
import { runWithRequestMeta } from "@getstrata/core/http/requestMetaContext";
import { createRequirePasswordConfirmMiddleware } from "@getstrata/core/http/requirePasswordConfirmMiddleware";

for (const authenticated of [false, true]) {
  test(`explicit API password confirmation stays JSON for HTMX headers (authenticated=${authenticated})`, async () => {
    const response = await runWithRequestMeta(
      { ipAddress: null, userAgent: null, errorFormat: "json" },
      () =>
        runWithAuthUser(authenticated ? { id: 1, role: "member", authVersion: 0 } : null, () =>
          createRequirePasswordConfirmMiddleware()(
            new Request("http://example.test/api/v1/auth/mfa", {
              method: "POST",
              headers: { "HX-Request": "true", accept: "text/html" },
            }),
            async () => new Response("must not run"),
          ),
        ),
    );
    expect(response.status).toBe(authenticated ? 423 : 401);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({
      error: authenticated ? "Password confirmation required." : "Authentication required.",
    });
  });
}
