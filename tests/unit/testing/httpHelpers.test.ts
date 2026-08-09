import { afterEach, describe, expect, test } from "bun:test";
import { TEST_ADMIN_API_TOKEN } from "../../../src/domain/auth";
import {
  actingAs,
  actingAsHeaders,
  postForm,
  postJson,
  resetActingAs,
} from "../../../src/testing/httpHelpers";

describe("actingAs", () => {
  afterEach(() => {
    resetActingAs();
  });

  test("sets dev auth headers from the acting user", () => {
    actingAs({ id: 42, role: "admin" });

    expect(actingAsHeaders()).toEqual({
      "x-authenticated-user-id": "42",
      "x-authenticated-user-role": "admin",
    });
  });

  test("uses bearer token when provided", () => {
    actingAs({ id: 1, role: "admin" }, { token: TEST_ADMIN_API_TOKEN });

    expect(actingAsHeaders()).toEqual({
      authorization: `Bearer ${TEST_ADMIN_API_TOKEN}`,
    });
  });

  test("clears acting state", () => {
    actingAs({ id: 1, role: "member" });
    resetActingAs();

    expect(actingAsHeaders()).toEqual({});
  });
});

describe("postJson", () => {
  afterEach(() => {
    resetActingAs();
  });

  test("posts JSON with acting headers", async () => {
    actingAs({ id: 7, role: "admin" });

    const server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        const payload = request.headers.get("content-type")?.includes("json")
          ? await request.json()
          : null;

        return Response.json({
          method: request.method,
          contentType: request.headers.get("content-type"),
          userId: request.headers.get("x-authenticated-user-id"),
          body: payload,
        });
      },
    });

    try {
      const response = await postJson(`${server.url}items`, { name: "Widget" });
      const body = (await response.json()) as {
        method: string;
        contentType: string;
        userId: string;
        body: { name: string };
      };

      expect(body.method).toBe("POST");
      expect(body.contentType).toBe("application/json");
      expect(body.userId).toBe("7");
      expect(body.body).toEqual({ name: "Widget" });
    } finally {
      server.stop(true);
    }
  });
});

describe("postForm", () => {
  afterEach(() => {
    resetActingAs();
  });

  test("posts urlencoded form data", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        const body = await request.text();

        return Response.json({
          method: request.method,
          contentType: request.headers.get("content-type"),
          body,
        });
      },
    });

    try {
      const response = await postForm(`${server.url}login`, {
        email: "admin@workhub.test",
        password: "password",
      });
      const body = (await response.json()) as {
        method: string;
        contentType: string;
        body: string;
      };

      expect(body.method).toBe("POST");
      expect(body.contentType).toBe("application/x-www-form-urlencoded");
      expect(body.body).toBe("email=admin%40workhub.test&password=password");
    } finally {
      server.stop(true);
    }
  });
});
