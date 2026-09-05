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

      expect(spec.info.title).toBe("Strata API");
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

  test("marks GET /users/me/sessions as bearer-authenticated", () => {
    const spec = generateOpenApiSpec([
      { method: "GET", path: "/api/v1/users/me/sessions", middleware: ["global", "api"] },
      { method: "GET", path: "/api/v1/organizations", middleware: ["global", "api"] },
    ]);

    expect(operation(spec, "/api/v1/users/me/sessions", "get")?.security).toEqual([
      { bearerAuth: [] },
    ]);
    expect(operation(spec, "/api/v1/organizations", "get")?.security).toBeUndefined();
  });

  test("marks the JSON two-factor challenge as a public OpenAPI operation", () => {
    const spec = generateOpenApiSpec([
      { method: "POST", path: "/api/v1/auth/two-factor-challenge", middleware: ["global", "api"] },
    ]);

    expect(operation(spec, "/api/v1/auth/two-factor-challenge", "post")?.summary).toBe(
      "Complete two-factor login challenge",
    );
    expect(operation(spec, "/api/v1/auth/two-factor-challenge", "post")?.security).toBeUndefined();
  });

  test("marks password reset and email verification routes as public OpenAPI operations", () => {
    const spec = generateOpenApiSpec([
      { method: "POST", path: "/api/v1/auth/forgot-password", middleware: ["global", "api"] },
      { method: "POST", path: "/api/v1/auth/reset-password", middleware: ["global", "api"] },
      {
        method: "POST",
        path: "/api/v1/auth/email/verification-notification",
        middleware: ["global", "api"],
      },
    ]);

    expect(operation(spec, "/api/v1/auth/forgot-password", "post")?.summary).toBe(
      "Request a password reset email",
    );
    expect(operation(spec, "/api/v1/auth/reset-password", "post")?.summary).toBe(
      "Reset password with email and token",
    );
    expect(operation(spec, "/api/v1/auth/email/verification-notification", "post")?.summary).toBe(
      "Resend email verification link",
    );
    expect(operation(spec, "/api/v1/auth/forgot-password", "post")?.security).toBeUndefined();
    expect(operation(spec, "/api/v1/auth/reset-password", "post")?.security).toBeUndefined();
    expect(
      operation(spec, "/api/v1/auth/email/verification-notification", "post")?.security,
    ).toBeUndefined();
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
      expect(sdk).toContain("export class StrataClient {");
      expect(sdk).toContain("async getAuditLogs(");
      expect(sdk).toContain('this.request("/audit-logs"');
    } finally {
      restoreEnvVar("APP_SDK_CLASS", previousClass);
      restoreEnvVar("APP_NAME", previousName);
    }
  });

  test("marks HiroApp login, JWT mint, and public careers as unauthenticated", () => {
    const previousPrefix = process.env.API_PREFIX;
    process.env.API_PREFIX = "/api";

    try {
      const spec = generateOpenApiSpec([
        { method: "POST", path: "/api/login", middleware: ["global", "api"] },
        { method: "POST", path: "/api/auth/token", middleware: ["global", "api"] },
        { method: "GET", path: "/api/careers", middleware: ["global"] },
        { method: "GET", path: "/api/careers/:id", middleware: ["global"] },
        { method: "POST", path: "/api/apply/login", middleware: ["global", "api"] },
        { method: "GET", path: "/api/integrations/ping", middleware: ["global", "api"] },
        { method: "POST", path: "/api/auth/tokens", middleware: ["global", "api"] },
      ]);

      expect(operation(spec, "/api/login", "post")?.summary).toBe("Login with email and password");
      expect(operation(spec, "/api/login", "post")?.security).toBeUndefined();
      expect(operation(spec, "/api/auth/token", "post")?.summary).toBe(
        "Mint a short-lived JWT with email and password",
      );
      expect(operation(spec, "/api/auth/token", "post")?.security).toBeUndefined();
      expect(operation(spec, "/api/apply/login", "post")?.summary).toBe(
        "Candidate portal login (opaque token)",
      );
      expect(operation(spec, "/api/apply/login", "post")?.security).toBeUndefined();
      expect(operation(spec, "/api/careers", "get")?.security).toBeUndefined();
      expect(operation(spec, "/api/careers/{id}", "get")?.security).toBeUndefined();
      expect(operation(spec, "/api/integrations/ping", "get")?.summary).toBe(
        "Partner heartbeat (requires integrations:ping)",
      );
      expect(operation(spec, "/api/integrations/ping", "get")?.security).toEqual([
        { bearerAuth: [] },
      ]);
      expect(operation(spec, "/api/auth/tokens", "post")?.security).toEqual([{ bearerAuth: [] }]);
    } finally {
      restoreEnvVar("API_PREFIX", previousPrefix);
    }
  });

  test("honors APP_NAME and APP_SDK_CLASS for a generated client", () => {
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
