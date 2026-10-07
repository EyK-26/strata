import { expect, test } from "bun:test";
import { createHttpKernel } from "@getstrata/bootstrap/httpKernel";
import { ServiceContainer } from "@getstrata/core/contracts/container";
import { composeMiddleware, type Middleware } from "@getstrata/core/http/middleware";
import { withJsonErrorHandling } from "@getstrata/core/http/response";
import type { RouteRequest } from "@getstrata/core/http/route";
import { withMiddleware } from "@getstrata/core/http/routeMiddleware";
import { bindRouteModel } from "@getstrata/core/http/routeModelBinding";
import { createMockDependencies } from "./testHelpers";

test("typed composition retains native Bun params, request identity, order and short circuits", async () => {
  const kernel = createHttpKernel(createMockDependencies(new ServiceContainer()));
  const calls: string[] = [];
  let native: Request | undefined;
  const outer: Middleware = async (request, next) => {
    native = request;
    calls.push("outer-before");
    const response = await next();
    calls.push("outer-after");
    return response;
  };
  const inner: Middleware = async (_request, next) => {
    calls.push("inner-before");
    const response = await next();
    calls.push("inner-after");
    return response;
  };
  const handler = bindRouteModel(
    "id",
    async (id, request: RouteRequest<{ id: string }>) => {
      expect(request === native).toBe(true);
      expect(request).toBeInstanceOf(Request);
      return { id };
    },
    (request, item) => {
      calls.push("handler");
      return Response.json({ id: request.params.id, modelId: item.id });
    },
  );
  const route = kernel.wrap([], withJsonErrorHandling(composeMiddleware(outer, inner)(handler)));
  const denied = withMiddleware(async () => new Response("denied", { status: 403 }))(handler);
  const server = Bun.serve({ port: 0, routes: { "/items/:id": route, "/denied/:id": denied } });
  try {
    const response = await fetch(`http://localhost:${server.port}/items/42`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: "42", modelId: 42 });
    expect(calls).toEqual([
      "outer-before",
      "inner-before",
      "handler",
      "inner-after",
      "outer-after",
    ]);
    calls.length = 0;
    const invalid = await fetch(`http://localhost:${server.port}/items/no-number`);
    expect(invalid.status).toBe(400);
    expect(calls).toEqual(["outer-before", "inner-before"]);
    calls.length = 0;
    expect((await fetch(`http://localhost:${server.port}/denied/42`)).status).toBe(403);
    expect(calls).toEqual([]);
  } finally {
    server.stop(true);
  }
});
