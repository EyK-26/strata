import { apiPrefix, appDisplayName, appUrl, sdkClientClassName } from "../runtime/appKeyPrefix";
import type { RegisteredRoute } from "./registeredRoute";

interface OpenApiSpec {
  openapi: string;
  info: { title: string; version: string };
  servers: Array<{ url: string; description?: string }>;
  paths: Record<string, Record<string, unknown>>;
  components: {
    securitySchemes: Record<string, unknown>;
    schemas?: Record<string, unknown>;
  };
}

const PUBLIC_ROUTE_DESCRIPTIONS: Record<string, string> = {
  "GET /auth/me": "Current authenticated user",
  "POST /auth/login": "Login with email and password",
  "POST /auth/register": "Register with name, email, and password",
  "POST /auth/forgot-password": "Request a password reset email",
  "POST /auth/reset-password": "Reset password with email and token",
  "GET /auth/tokens": "List API tokens",
  "POST /auth/tokens": "Create API token",
  "DELETE /auth/tokens/:id": "Revoke API token",
  "GET /users/me/export": "GDPR export of user data",
  "DELETE /users/me": "GDPR account erasure (anonymize user, revoke tokens)",
  "GET /organizations": "List organizations",
  "POST /organizations": "Create organization",
  "GET /organizations/:id/members": "List organization members",
  "GET /projects": "List projects",
  "POST /projects": "Create project",
  "GET /tasks": "List tasks",
  "POST /tasks": "Create task",
  "GET /search": "Full-text search tasks and comments",
  "GET /audit-logs": "List audit log entries",
  "GET /webhooks": "List webhooks",
  "POST /webhooks": "Create webhook",
  "GET /reports/summary": "Cross-module summary report",
  "GET /admin/stats": "Platform statistics",
  "GET /admin/tenants": "List tenants",
  "GET /admin/features": "Runtime feature flags",
  "GET /billing/subscription": "Current tenant subscription",
  "POST /billing/webhooks/stripe": "Stripe webhook receiver (stub)",
  "GET /scim/v2/Users": "SCIM list users",
  "POST /scim/v2/Users": "SCIM create user",
  "GET /scim/v2/Groups": "SCIM list groups (organizations)",
  "GET /health": "Liveness probe",
  "GET /ready": "Readiness probe",
  "GET /metrics": "Prometheus metrics",
};

function toOpenApiPath(path: string): string {
  return path.replace(/:([A-Za-z_]+)/g, "{$1}");
}

function toRelativeApiPath(path: string): string {
  const prefix = apiPrefix();

  if (path === prefix) {
    return "/";
  }

  if (path.startsWith(`${prefix}/`)) {
    return path.slice(prefix.length);
  }

  return path;
}

function requiresBearerAuth(path: string, method: string): boolean {
  const relative = toRelativeApiPath(path);

  if (
    relative.startsWith("/auth/login") ||
    relative.startsWith("/auth/register") ||
    relative.startsWith("/auth/forgot-password") ||
    relative.startsWith("/auth/reset-password") ||
    relative.startsWith("/auth/oauth")
  ) {
    return false;
  }

  if (
    relative.startsWith("/scim/") ||
    relative.startsWith("/billing/webhooks/") ||
    path.startsWith("/scim/") ||
    path.startsWith("/billing/webhooks/")
  ) {
    return false;
  }

  if (
    ["/health", "/ready", "/metrics", "/"].includes(relative) ||
    ["/health", "/ready", "/metrics", "/"].includes(path)
  ) {
    return false;
  }

  if (
    method === "GET" &&
    ["/organizations", "/projects", "/tasks", "/search"].some(
      (prefix) => relative.startsWith(prefix) || path.startsWith(prefix),
    )
  ) {
    return false;
  }

  return relative.startsWith("/auth/") || ["POST", "PATCH", "PUT", "DELETE"].includes(method);
}

function generateOpenApiSpec(routes: RegisteredRoute[]): OpenApiSpec {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const route of routes) {
    const openApiPath = toOpenApiPath(route.path);
    const method = route.method.toLowerCase();
    const description =
      PUBLIC_ROUTE_DESCRIPTIONS[`${route.method} ${toRelativeApiPath(route.path)}`] ??
      PUBLIC_ROUTE_DESCRIPTIONS[`${route.method} ${route.path}`] ??
      `${route.method} ${route.path}`;

    paths[openApiPath] ??= {};
    paths[openApiPath][method] = {
      summary: description,
      ...(requiresBearerAuth(route.path, route.method) ? { security: [{ bearerAuth: [] }] } : {}),
      responses: {
        "200": { description: "OK" },
        "201": { description: "Created" },
        "204": { description: "No Content" },
        "400": { description: "Bad Request" },
        "401": { description: "Unauthorized" },
        "403": { description: "Forbidden" },
        "404": { description: "Not Found" },
        "422": { description: "Validation Error" },
      },
    };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: `${appDisplayName()} API`,
      version: "1.0.0",
    },
    servers: [
      { url: `${appUrl()}${apiPrefix()}`, description: `${appDisplayName()} API` },
      { url: appUrl(), description: "Root (health, metrics, SCIM)" },
    ],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
        },
      },
      schemas: {
        ErrorResponse: {
          type: "object",
          properties: {
            error: { type: "string" },
            details: { type: "object", additionalProperties: true },
          },
          required: ["error"],
        },
        UserResource: {
          type: "object",
          properties: {
            id: { type: "integer" },
            name: { type: "string" },
            email: { type: "string" },
            role: { type: "string" },
          },
        },
        OrganizationResource: {
          type: "object",
          properties: {
            id: { type: "integer" },
            name: { type: "string" },
            slug: { type: "string" },
          },
        },
        PaginatedMeta: {
          type: "object",
          properties: {
            page: { type: "integer" },
            per_page: { type: "integer" },
            total: { type: "integer" },
            last_page: { type: "integer" },
          },
        },
      },
    },
  };
}

function renderOpenApiDocument(spec: OpenApiSpec): string {
  return `${JSON.stringify(spec, null, 2)}\n`;
}

function toMethodName(method: string, path: string, apiPrefix: string): string {
  const relativePath = path.startsWith(apiPrefix) ? path.slice(apiPrefix.length) || "/" : path;

  const segments = relativePath
    .replace(/\{|\}/g, "")
    .split("/")
    .filter(Boolean)
    .flatMap((segment) => segment.split("-"))
    .map((segment) => segment.replace(/[^a-zA-Z0-9]/g, ""))
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1));

  return `${method.toLowerCase()}${segments.join("")}`;
}

function toRequestPath(path: string, apiPrefix: string): string {
  return path.startsWith(apiPrefix) ? path.slice(apiPrefix.length) || "/" : path;
}

function renderTypeScriptSdk(spec: OpenApiSpec, prefix = apiPrefix()): string {
  const lines = [
    `export class ${sdkClientClassName()} {`,
    `  constructor(private readonly baseUrl = "${spec.servers[0]?.url ?? ""}") {}`,
    "",
    "  private async request(path: string, init: RequestInit = {}): Promise<Response> {",
    `    return await fetch(\`\${this.baseUrl}\${path}\`, init);`,
    "  }",
    "",
  ];

  for (const [path, methods] of Object.entries(spec.paths)) {
    const requestPath = toRequestPath(path, prefix);

    for (const method of Object.keys(methods)) {
      const functionName = toMethodName(method, path, prefix);

      lines.push(
        `  async ${functionName}(init: RequestInit = {}): Promise<Response> {`,
        `    return await this.request("${requestPath}", { ...init, method: "${method.toUpperCase()}" });`,
        "  }",
        "",
      );
    }
  }

  lines.push("}", "");
  return lines.join("\n");
}

export type { OpenApiSpec };
export { generateOpenApiSpec, renderOpenApiDocument, renderTypeScriptSdk };
