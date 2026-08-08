import { appConfig } from "../../config/app";
import type { RegisteredRoute } from "../../bootstrap/routeRegistry";

interface OpenApiSpec {
  openapi: string;
  info: { title: string; version: string };
  servers: Array<{ url: string }>;
  paths: Record<string, Record<string, unknown>>;
  components: {
    securitySchemes: Record<string, unknown>;
  };
}

const PUBLIC_ROUTE_DESCRIPTIONS: Record<string, string> = {
  "GET /auth/me": "Current authenticated user",
  "POST /auth/login": "Login with email and password",
  "GET /auth/tokens": "List API tokens",
  "POST /auth/tokens": "Create API token",
  "DELETE /auth/tokens/:id": "Revoke API token",
  "GET /organizations": "List organizations",
  "POST /organizations": "Create organization",
  "GET /projects": "List projects",
  "POST /projects": "Create project",
  "GET /tasks": "List tasks",
  "POST /tasks": "Create task",
  "GET /search": "Full-text search tasks and comments",
  "GET /audit-logs": "List audit log entries",
  "GET /webhooks": "List webhooks",
  "POST /webhooks": "Create webhook",
  "GET /reports/summary": "Cross-module summary report",
  "GET /health": "Liveness probe",
  "GET /ready": "Readiness probe",
  "GET /metrics": "Prometheus metrics",
};

function toOpenApiPath(path: string): string {
  return path.replace(/:([A-Za-z_]+)/g, "{$1}");
}

function requiresBearerAuth(path: string, method: string): boolean {
  if (path.startsWith("/auth/login") || path.startsWith("/auth/oauth")) {
    return false;
  }

  if (["/health", "/ready", "/metrics", "/"].includes(path)) {
    return false;
  }

  if (method === "GET" && ["/organizations", "/projects", "/tasks", "/search"].some((prefix) => path.startsWith(prefix))) {
    return false;
  }

  return path.startsWith("/auth/") || ["POST", "PATCH", "PUT", "DELETE"].includes(method);
}

function generateOpenApiSpec(routes: RegisteredRoute[]): OpenApiSpec {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const route of routes) {
    const openApiPath = toOpenApiPath(route.path);
    const method = route.method.toLowerCase();
    const description =
      PUBLIC_ROUTE_DESCRIPTIONS[`${route.method} ${route.path}`] ??
      `${route.method} ${route.path}`;

    paths[openApiPath] ??= {};
    paths[openApiPath][method] = {
      summary: description,
      ...(requiresBearerAuth(route.path, route.method)
        ? { security: [{ bearerAuth: [] }] }
        : {}),
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
      title: "WorkHub API",
      version: "1.0.0",
    },
    servers: [{ url: `${appConfig.url}${appConfig.apiPrefix}` }],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
        },
      },
    },
  };
}

function renderOpenApiDocument(spec: OpenApiSpec): string {
  return `${JSON.stringify(spec, null, 2)}\n`;
}

function toMethodName(method: string, path: string, apiPrefix: string): string {
  const relativePath = path.startsWith(apiPrefix)
    ? path.slice(apiPrefix.length) || "/"
    : path;

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

function renderTypeScriptSdk(spec: OpenApiSpec, apiPrefix = "/api/v1"): string {
  const lines = [
    "export class WorkHubClient {",
    `  constructor(private readonly baseUrl = "${spec.servers[0]?.url ?? ""}") {}`,
    "",
    "  private async request(path: string, init: RequestInit = {}): Promise<Response> {",
    "    return await fetch(`${this.baseUrl}${path}`, init);",
    "  }",
    "",
  ];

  for (const [path, methods] of Object.entries(spec.paths)) {
    const requestPath = toRequestPath(path, apiPrefix);

    for (const method of Object.keys(methods)) {
      const functionName = toMethodName(method, path, apiPrefix);

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

export { generateOpenApiSpec, renderOpenApiDocument, renderTypeScriptSdk };
export type { OpenApiSpec };
