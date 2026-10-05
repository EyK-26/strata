import { describe, expect, test } from "bun:test";
import { registerOpenApiRouteMap } from "@getstrata/bootstrap/buildModuleRoutes";
import { routeRegistry } from "@getstrata/bootstrap/routeRegistry";
import { generateOpenApiSpec, renderTypeScriptSdk } from "@getstrata/core/openapi/generator";
import type { OpenApiOperation } from "@getstrata/core/openapi/registeredRoute";
import { validateOpenApiSpec } from "@getstrata/core/openapi/validate";

const metadata: OpenApiOperation = {
  summary: "Create an order",
  parameters: [
    {
      name: "Idempotency-Key",
      in: "header",
      required: true,
      schema: { type: "string", minLength: 16 },
    },
  ],
  requestBody: {
    required: true,
    content: {
      "application/json": {
        schema: { type: "object", properties: { quantity: { type: "integer" } } },
      },
    },
  },
  responses: {
    "200": {
      description: "Accepted",
      content: {
        "application/json": { schema: { type: "object", properties: { id: { type: "integer" } } } },
      },
    },
    "409": { description: "Conflicting identity" },
  },
};
describe("application OpenAPI metadata", () => {
  test("registration preserves operation metadata without changing runtime handlers", () => {
    routeRegistry.clear();
    const handler = () => new Response("ok");
    const routes = registerOpenApiRouteMap(
      { "/api/v1/orders": { GET: handler, POST: handler } },
      ["api"],
      { "/api/v1/orders": { POST: metadata } },
    );
    expect((routes["/api/v1/orders"] as Record<string, unknown>).POST).toBe(handler);
    const spec = generateOpenApiSpec(routeRegistry.list());
    expect(spec.paths["/api/v1/orders"]?.post).toMatchObject(metadata);
    expect(spec.paths["/api/v1/orders"]?.get).not.toHaveProperty("parameters");
    expect(validateOpenApiSpec(spec)).toEqual([]);
    const sdk = renderTypeScriptSdk(spec);
    expect(sdk).toContain('operationHeaders: { "Idempotency-Key": string }');
    expect(sdk).toContain('headers.set("Idempotency-Key"');
    expect(sdk).toContain("async getOrders(init: RequestInit = {})");
    routeRegistry.clear();
  });
  test("reports invalid path and duplicate header parameters", () => {
    const spec = generateOpenApiSpec([
      {
        method: "GET",
        path: "/things/:id",
        middleware: [],
        openApi: {
          parameters: [
            { name: "id", in: "path", schema: { type: "integer" } },
            { name: "Key", in: "header", schema: { type: "string" } },
            { name: "key", in: "header", schema: { type: "string" } },
          ],
        },
      },
    ]);
    expect(validateOpenApiSpec(spec).join("\n")).toContain("required");
    expect(validateOpenApiSpec(spec).join("\n")).toContain("Duplicate");
  });
});

test("generated SDK requires and sends declared headers without losing native headers", async () => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = await mkdtemp(join(tmpdir(), "strata-openapi-"));
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      return Response.json({
        key: request.headers.get("Idempotency-Key"),
        auth: request.headers.get("Authorization"),
        method: request.method,
      });
    },
  });
  try {
    const spec = generateOpenApiSpec([
      { method: "POST", path: "/api/v1/orders", middleware: [], openApi: metadata },
    ]);
    const sdk = renderTypeScriptSdk(spec);
    await writeFile(join(directory, "client.ts"), sdk);
    const loaded = await import(join(directory, "client.ts"));
    const Client = Object.values(loaded).find((value) => typeof value === "function") as new (
      url: string,
    ) => {
      postOrders(
        init: RequestInit & { operationHeaders: { "Idempotency-Key": string } },
      ): Promise<Response>;
    };
    const client = new Client(`http://localhost:${server.port}`);
    const response = await client.postOrders({
      operationHeaders: { "Idempotency-Key": "stable-checkout-key" },
      headers: new Headers({ Authorization: "Bearer fixture" }),
    });
    expect(await response.json()).toEqual({
      key: "stable-checkout-key",
      auth: "Bearer fixture",
      method: "POST",
    });
    await expect(client.postOrders({} as never)).rejects.toThrow("Required operation header");
    await writeFile(
      join(directory, "types.ts"),
      `${sdk}\nconst client = new ${Object.keys(loaded)[0]}();\n// @ts-expect-error Required operation header is missing\nclient.postOrders({});\nclient.postOrders({operationHeaders: {"Idempotency-Key":"key"}});\n`,
    );
    const compiler = Bun.spawn(
      [
        "bun",
        "x",
        "--no-install",
        "tsc",
        "--ignoreConfig",
        "--noEmit",
        "--strict",
        "--skipLibCheck",
        "--lib",
        "ES2022,DOM",
        join(directory, "types.ts"),
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [exit, output, errors] = await Promise.all([
      compiler.exited,
      new Response(compiler.stdout).text(),
      new Response(compiler.stderr).text(),
    ]);
    expect(output + errors).toBe("");
    expect(exit).toBe(0);
  } finally {
    server.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
});
