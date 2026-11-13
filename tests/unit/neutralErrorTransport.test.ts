import { describe, expect, test } from "bun:test";
import { AuthenticationRequiredError } from "@getstrata/core/auth/authOutcome";
import { RecordNotFoundError } from "@getstrata/core/database/errors";
import { errorResponse } from "@getstrata/core/http/response";
import { webErrorResponse } from "@getstrata/core/http/webErrorResponse";

describe("neutral failures at the HTTP boundary", () => {
  test.each([
    [new RecordNotFoundError("Widget 99 not found."), 404],
    [new AuthenticationRequiredError(), 401],
  ] as const)("maps %s to JSON %i", async (error, status) => {
    expect(error).not.toHaveProperty("status");
    const response = errorResponse(error);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: error.message });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  test("renders record misses as HTML 404 and redirects required authentication", async () => {
    const request = new Request("http://example.test/widgets", {
      headers: { accept: "text/html" },
    });
    const options = { enabled: true, production: false };
    const missing = await webErrorResponse(
      new RecordNotFoundError("Widget 99 not found."),
      request,
      options,
    );
    expect(missing?.status).toBe(404);
    expect(await missing?.text()).toContain("Widget 99 not found.");
    const guest = await webErrorResponse(new AuthenticationRequiredError(), request, options);
    expect(guest?.status).toBe(302);
    expect(guest?.headers.get("location")).toContain("/login");
  });
});
