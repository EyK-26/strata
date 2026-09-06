import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { ConflictError } from "@getstrata/core/errors/http";
import { withErrorHandling } from "@getstrata/core/http/response";

const previousFrontendMode = process.env.FRONTEND_MODE;

afterEach(() => {
  if (previousFrontendMode === undefined) {
    delete process.env.FRONTEND_MODE;
  } else {
    process.env.FRONTEND_MODE = previousFrontendMode;
  }
});

describe("withErrorHandling", () => {
  test("unknown exceptions become a generic 500 and are logged with their stack", async () => {
    process.env.FRONTEND_MODE = "api";
    const errorLog = spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const handler = withErrorHandling(async (_request: Request) => {
        throw new TypeError("undefined is not an object (evaluating 'table.columns.map')");
      });
      const response = await handler(new Request("http://app.test/api/things"));
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Internal server error." });

      const logged = errorLog.mock.calls.map((call) => String(call[0])).join("\n");
      expect(logged).toContain("Unhandled request error");
      expect(logged).toContain("table.columns.map");
    } finally {
      errorLog.mockRestore();
    }
  });

  test("HttpError instances keep their status and message and are not logged as server errors", async () => {
    process.env.FRONTEND_MODE = "api";
    const errorLog = spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const handler = withErrorHandling(async (_request: Request) => {
        throw new ConflictError("Email is already registered.");
      });
      const response = await handler(new Request("http://app.test/api/things"));
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: "Email is already registered." });
      expect(errorLog).not.toHaveBeenCalled();
    } finally {
      errorLog.mockRestore();
    }
  });

  test("driver constraint errors map to 4xx without echoing SQL details", async () => {
    process.env.FRONTEND_MODE = "api";
    const handler = withErrorHandling(async (_request: Request) => {
      throw Object.assign(new Error("UNIQUE constraint failed: users.email"), {
        code: "SQLITE_CONSTRAINT_UNIQUE",
        errno: 2067,
      });
    });
    const response = await handler(new Request("http://app.test/api/things"));
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("A record with these values already exists.");
    expect(body.error).not.toContain("users.email");
  });
});
