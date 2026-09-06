import { afterEach, describe, expect, test } from "bun:test";
import {
  BadRequestError,
  ForbiddenError,
  HttpError,
  UnauthorizedError,
  ValidationError,
} from "@getstrata/core/errors/http";
import { normalizeFieldErrors, webErrorResponse } from "@getstrata/core/http/webErrorResponse";
import { resetWebErrorViewForTests } from "@getstrata/core/view/webErrorView";
import { restoreEnvVar } from "../helpers/restoreEnv";

describe("normalizeFieldErrors", () => {
  test("returns an empty object for invalid details", () => {
    expect(normalizeFieldErrors(null)).toEqual({});
    expect(normalizeFieldErrors(undefined)).toEqual({});
    expect(normalizeFieldErrors("invalid")).toEqual({});
    expect(normalizeFieldErrors([])).toEqual({});
  });

  test("normalizes array and string messages", () => {
    expect(
      normalizeFieldErrors({
        name: ["is required", 42],
        slug: "already taken",
        ignored: 123,
      }),
    ).toEqual({
      name: ["is required", "42"],
      slug: ["already taken"],
    });
  });
});

describe("webErrorResponse", () => {
  const previousFrontendMode = process.env.FRONTEND_MODE;

  afterEach(() => {
    resetWebErrorViewForTests();

    if (previousFrontendMode === undefined) {
      delete process.env.FRONTEND_MODE;
    } else {
      restoreEnvVar("FRONTEND_MODE", previousFrontendMode);
    }
  });

  test("returns null when request is missing", async () => {
    expect(await webErrorResponse(new BadRequestError("Bad Request"))).toBeNull();
  });

  test("returns null when views are disabled", async () => {
    delete process.env.FRONTEND_MODE;

    const request = new Request("http://example.test/widgets", {
      headers: { accept: "text/html" },
    });

    expect(await webErrorResponse(new BadRequestError("Bad Request"), request)).toBeNull();
  });

  test("returns null when the client prefers JSON", async () => {
    process.env.FRONTEND_MODE = "server-htmx";

    const request = new Request("http://example.test/api/v1/widgets", {
      headers: { accept: "application/json" },
    });

    expect(await webErrorResponse(new BadRequestError("Bad Request"), request)).toBeNull();
  });

  test("returns null for /api/ even when Accept is HTML", async () => {
    process.env.FRONTEND_MODE = "hybrid";

    const request = new Request("http://example.test/api/apply/me", {
      headers: { accept: "text/html" },
    });

    expect(await webErrorResponse(new ForbiddenError("staff cookie"), request)).toBeNull();
  });

  test("redirects unauthorized errors to login", async () => {
    process.env.FRONTEND_MODE = "server-htmx";

    const request = new Request("http://example.test/widgets/new?tab=info", {
      headers: { accept: "text/html" },
    });

    const response = await webErrorResponse(new UnauthorizedError(), request);

    expect(response?.status).toBe(302);
    expect(response?.headers.get("location")).toBe("/login?redirect=%2Fwidgets%2Fnew%3Ftab%3Dinfo");
  });

  test("renders validation errors with field summaries", async () => {
    process.env.FRONTEND_MODE = "server-htmx";

    const request = new Request("http://example.test/widgets", {
      method: "POST",
      headers: { accept: "text/html" },
    });
    const error = new ValidationError("Validation failed", {
      name: ["is required"],
      slug: "already taken",
    });

    const response = await webErrorResponse(error, request);
    const html = await response?.text();

    expect(response?.status).toBe(422);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain('href="/assets/app.css"');
    expect(html).toContain("Validation failed");
    expect(html).toContain("name: is required");
    expect(html).toContain("slug: already taken");
    expect(html).toContain("Go back");
  });

  test("falls back to the validation message when field details are empty", async () => {
    process.env.FRONTEND_MODE = "server-htmx";

    const request = new Request("http://example.test/widgets", {
      headers: { accept: "text/html" },
    });
    const error = new ValidationError("Validation failed", null);

    const response = await webErrorResponse(error, request);
    const html = await response?.text();

    expect(html).toContain("Validation failed");
  });

  test("renders generic HTTP errors as HTML", async () => {
    process.env.FRONTEND_MODE = "server-htmx";

    const request = new Request("http://example.test/widgets", {
      headers: { accept: "text/html" },
    });

    const response = await webErrorResponse(new BadRequestError("Invalid widget"), request);
    const html = await response?.text();

    expect(response?.status).toBe(400);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain('href="/assets/app.css"');
    expect(html).toContain("Invalid widget");
  });

  test("renders a foreign Forbidden-shaped error as HTTP 403", async () => {
    process.env.FRONTEND_MODE = "server-htmx";

    class ForeignForbidden extends Error {
      readonly status = 403;

      constructor() {
        super("Forbidden");
        this.name = "ForbiddenError";
      }
    }

    const request = new Request("http://example.test/users", {
      headers: { accept: "text/html" },
    });
    const foreign = new ForeignForbidden();

    expect(foreign instanceof HttpError).toBe(false);

    const response = await webErrorResponse(foreign, request);
    const html = await response?.text();

    expect(response?.status).toBe(403);
    expect(html).toContain("Forbidden");
  });

  test("renders ForbiddenError as HTTP 403", async () => {
    process.env.FRONTEND_MODE = "server-htmx";

    const request = new Request("http://example.test/users", {
      headers: { accept: "text/html" },
    });

    const response = await webErrorResponse(new ForbiddenError(), request);
    const html = await response?.text();

    expect(response?.status).toBe(403);
    expect(html).toContain("Forbidden");
  });

  test("maps non-http errors through mapDatabaseError", async () => {
    process.env.FRONTEND_MODE = "server-htmx";

    const request = new Request("http://example.test/widgets", {
      headers: { accept: "text/html" },
    });

    const response = await webErrorResponse(new Error("connection refused"), request);
    const html = await response?.text();

    expect(response?.status).toBe(500);
    expect(html).not.toContain("connection refused");
    expect(html).toContain("Internal server error.");
  });

  test("passes through existing HttpError instances", async () => {
    process.env.FRONTEND_MODE = "server-htmx";

    const request = new Request("http://example.test/widgets", {
      headers: { accept: "text/html" },
    });
    const error = new HttpError(418, "I am a teapot");

    const response = await webErrorResponse(error, request);
    const html = await response?.text();

    expect(response?.status).toBe(418);
    expect(html).toContain("I am a teapot");
  });
});
