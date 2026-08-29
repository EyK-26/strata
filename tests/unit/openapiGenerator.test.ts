import { describe, expect, test } from "bun:test";
import { generateOpenApiSpec, renderTypeScriptSdk } from "@getstrata/core/openapi/generator";
import { restoreEnvVar } from "../helpers/restoreEnv";

describe("generateOpenApiSpec", () => {
  test("maps registered routes into an OpenAPI document", () => {
    const previousName = process.env.APP_NAME;
    delete process.env.APP_NAME;

    try {
      const spec = generateOpenApiSpec([
        { method: "GET", path: "/api/v1/audit-logs", middleware: ["global", "api"] },
        { method: "DELETE", path: "/api/v1/projects/:id", middleware: ["global", "api"] },
      ]);

      expect(spec.info.title).toBe("WorkHub API");
      expect(spec.paths["/api/v1/audit-logs"]?.get).toBeDefined();
      expect(spec.paths["/api/v1/projects/{id}"]?.delete).toBeDefined();
      expect(spec.components.securitySchemes.bearerAuth).toBeDefined();
    } finally {
      restoreEnvVar("APP_NAME", previousName);
    }
  });

  test("renders valid TypeScript SDK method names", () => {
    const previousClass = process.env.APP_SDK_CLASS;
    const previousName = process.env.APP_NAME;
    delete process.env.APP_SDK_CLASS;
    delete process.env.APP_NAME;

    try {
      const spec = generateOpenApiSpec([
        { method: "GET", path: "/api/v1/audit-logs", middleware: [] },
      ]);

      const sdk = renderTypeScriptSdk(spec, "/api/v1");
      expect(sdk).toContain("export class WorkHubClient {");
      expect(sdk).toContain("async getAuditLogs(");
      expect(sdk).toContain('this.request("/audit-logs"');
    } finally {
      restoreEnvVar("APP_SDK_CLASS", previousClass);
      restoreEnvVar("APP_NAME", previousName);
    }
  });

  test("honors sibling APP_NAME and APP_SDK_CLASS", () => {
    const previousName = process.env.APP_NAME;
    const previousClass = process.env.APP_SDK_CLASS;
    process.env.APP_NAME = "Forum";
    process.env.APP_SDK_CLASS = "ForumClient";

    try {
      const spec = generateOpenApiSpec([]);
      const sdk = renderTypeScriptSdk(spec);

      expect(spec.info.title).toBe("Forum API");
      expect(spec.servers[0]?.description).toBe("Forum API");
      expect(sdk).toContain("export class ForumClient {");
    } finally {
      restoreEnvVar("APP_NAME", previousName);
      restoreEnvVar("APP_SDK_CLASS", previousClass);
    }
  });
});
