import { describe, expect, test } from "bun:test";
import { generateOpenApiSpec, renderTypeScriptSdk } from "@getstrata/core/openapi/generator";
import { restoreEnvVar } from "../helpers/restoreEnv";

interface OpenApiOperation {
  summary?: string;
  security?: Array<Record<string, unknown[]>>;
}

function operation(
  spec: ReturnType<typeof generateOpenApiSpec>,
  path: string,
  method: string,
): OpenApiOperation | undefined {
  return spec.paths[path]?.[method] as OpenApiOperation | undefined;
}

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

  test("marks login and register as public OpenAPI operations", () => {
    const spec = generateOpenApiSpec([
      { method: "POST", path: "/auth/login", middleware: ["global", "api"] },
      { method: "POST", path: "/auth/register", middleware: ["global", "api"] },
      { method: "GET", path: "/auth/me", middleware: ["global", "api"] },
    ]);

    expect(operation(spec, "/auth/login", "post")?.summary).toBe("Login with email and password");
    expect(operation(spec, "/auth/register", "post")?.summary).toBe(
      "Register with name, email, and password",
    );
    expect(operation(spec, "/auth/login", "post")?.security).toBeUndefined();
    expect(operation(spec, "/auth/register", "post")?.security).toBeUndefined();
    expect(operation(spec, "/auth/me", "get")?.security).toEqual([{ bearerAuth: [] }]);
  });

  test("marks password reset routes as public OpenAPI operations", () => {
    const spec = generateOpenApiSpec([
      { method: "POST", path: "/api/v1/auth/forgot-password", middleware: ["global", "api"] },
      { method: "POST", path: "/api/v1/auth/reset-password", middleware: ["global", "api"] },
    ]);

    expect(operation(spec, "/api/v1/auth/forgot-password", "post")?.summary).toBe(
      "Request a password reset email",
    );
    expect(operation(spec, "/api/v1/auth/reset-password", "post")?.summary).toBe(
      "Reset password with email and token",
    );
    expect(operation(spec, "/api/v1/auth/forgot-password", "post")?.security).toBeUndefined();
    expect(operation(spec, "/api/v1/auth/reset-password", "post")?.security).toBeUndefined();
  });

  test("strips API_PREFIX when classifying public auth operations", () => {
    const spec = generateOpenApiSpec([
      { method: "POST", path: "/api/v1/auth/login", middleware: ["global", "api"] },
      { method: "POST", path: "/api/v1/auth/register", middleware: ["global", "api"] },
      { method: "GET", path: "/api/v1/auth/me", middleware: ["global", "api"] },
    ]);

    expect(operation(spec, "/api/v1/auth/login", "post")?.summary).toBe(
      "Login with email and password",
    );
    expect(operation(spec, "/api/v1/auth/register", "post")?.summary).toBe(
      "Register with name, email, and password",
    );
    expect(operation(spec, "/api/v1/auth/login", "post")?.security).toBeUndefined();
    expect(operation(spec, "/api/v1/auth/register", "post")?.security).toBeUndefined();
    expect(operation(spec, "/api/v1/auth/me", "get")?.security).toEqual([{ bearerAuth: [] }]);
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
