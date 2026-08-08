import { describe, expect, test } from "bun:test";
import { generateOpenApiSpec, renderTypeScriptSdk } from "../../src/core/openapi/generator";

describe("generateOpenApiSpec", () => {
  test("maps registered routes into an OpenAPI document", () => {
    const spec = generateOpenApiSpec([
      { method: "GET", path: "/api/v1/audit-logs", middleware: ["global", "api"] },
      { method: "DELETE", path: "/api/v1/projects/:id", middleware: ["global", "api"] },
    ]);

    expect(spec.paths["/api/v1/audit-logs"]?.get).toBeDefined();
    expect(spec.paths["/api/v1/projects/{id}"]?.delete).toBeDefined();
    expect(spec.components.securitySchemes.bearerAuth).toBeDefined();
  });

  test("renders valid TypeScript SDK method names", () => {
    const spec = generateOpenApiSpec([
      { method: "GET", path: "/api/v1/audit-logs", middleware: [] },
    ]);

    const sdk = renderTypeScriptSdk(spec, "/api/v1");
    expect(sdk).toContain("async getAuditLogs(");
    expect(sdk).toContain('this.request("/audit-logs"');
  });
});
