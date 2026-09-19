import { afterEach, describe, expect, mock, test } from "bun:test";
import { bootstrapMonorepoOpenApiRoutes } from "../../../src/cli/commands/openApiBootstrap.ts";

afterEach(() => {
  mock.restore();
});

describe("shared OpenAPI CLI", () => {
  test("registerOpenApiRoutes delegates to @getstrata/cli/openapi with monorepo bootstrap", async () => {
    let bootstrapArg: (() => Promise<{ routes: Record<string, unknown> }>) | undefined;

    mock.module("@getstrata/cli/openapi", () => ({
      registerAppOpenApiRoutes: async (
        bootstrap: () => Promise<{ routes: Record<string, unknown> }>,
      ) => {
        bootstrapArg = bootstrap;
      },
    }));

    const { registerOpenApiRoutes } = await import(
      "../../../src/cli/commands/registerOpenApiRoutes.ts"
    );
    await registerOpenApiRoutes();

    expect(bootstrapArg).toBe(bootstrapMonorepoOpenApiRoutes);
  });

  test("monorepo openapi commands are built from @getstrata/cli/openapi factories", async () => {
    const { createOpenApiGenerateCommand } = await import("@getstrata/cli/openapi");
    const { openapiGenerateCommand } = await import("../../../src/cli/commands/openapiGenerate.ts");

    expect(typeof openapiGenerateCommand).toBe("function");
    expect(typeof createOpenApiGenerateCommand(bootstrapMonorepoOpenApiRoutes)).toBe("function");
  });
});
