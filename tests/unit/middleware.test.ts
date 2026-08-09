import { describe, expect, test } from "bun:test";
import {
  composeMiddleware,
  requestIdMiddleware,
  wrapRouteHandler,
} from "../../src/core/http/middleware";

describe("composeMiddleware", () => {
  test("runs middleware in order and passes control to the handler", async () => {
    const order: string[] = [];

    const handler = composeMiddleware(
      async (_req, next) => {
        order.push("first");
        const response = await next();
        order.push("first-after");
        return response;
      },
      async (_req, next) => {
        order.push("second");
        return await next();
      },
    )(async () => {
      order.push("handler");
      return Response.json({ ok: true });
    });

    const response = await handler(new Request("http://example.test"));

    expect(response.status).toBe(200);
    expect(order).toEqual(["first", "second", "handler", "first-after"]);
  });
});

describe("requestIdMiddleware", () => {
  test("adds X-Request-Id when the client did not send one", async () => {
    const handler = composeMiddleware(requestIdMiddleware)(async () => {
      return Response.json({ ok: true });
    });

    const response = await handler(new Request("http://example.test"));

    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/i);
  });

  test("preserves an incoming X-Request-Id header", async () => {
    const handler = composeMiddleware(requestIdMiddleware)(async () => {
      return Response.json({ ok: true });
    });

    const response = await handler(
      new Request("http://example.test", {
        headers: { "x-request-id": "req-123" },
      }),
    );

    expect(response.headers.get("x-request-id")).toBe("req-123");
  });
});

describe("wrapRouteHandler", () => {
  test("wraps method-based route maps and plain handlers", async () => {
    const wrapped = wrapRouteHandler(
      {
        GET: async (_request: Request) => Response.json({ method: "GET" }),
        POST: async (_request: Request) => Response.json({ method: "POST" }, { status: 201 }),
      },
      [requestIdMiddleware],
    );

    const getResponse = await wrapped.GET(new Request("http://example.test"));
    const postResponse = await wrapped.POST(new Request("http://example.test", { method: "POST" }));

    expect(getResponse.headers.get("x-request-id")).toBeTruthy();
    expect(await getResponse.json()).toEqual({ method: "GET" });
    expect(postResponse.status).toBe(201);
  });
});
