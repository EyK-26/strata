import { describe, expect, test } from "bun:test";
import { generateOpenApiSpec } from "../../src/core/openapi/generator";

describe("generateOpenApiSpec", () => {
  test("maps registered routes into an OpenAPI document", () => {
    const spec = generateOpenApiSpec([
      { method: "GET", path: "/api/v1/projects", middleware: ["global", "api"] },
      { method: "DELETE", path: "/api/v1/projects/:id", middleware: ["global", "api"] },
    ]);

    expect(spec.paths["/api/v1/projects"]?.get).toBeDefined();
    expect(spec.paths["/api/v1/projects/{id}"]?.delete).toBeDefined();
    expect(spec.components.securitySchemes.bearerAuth).toBeDefined();
  });
});
