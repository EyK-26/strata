import { randomBytes } from "node:crypto";
import type { AppModule } from "@getstrata/bootstrap/contracts";
import { routeParams } from "@getstrata/bootstrap/web/routing";
import { hashPassword } from "@getstrata/core/auth/password";
import { createScimAuthMiddleware } from "@getstrata/core/auth/scimAuthMiddleware";
import { withErrorHandling } from "@getstrata/core/http/response";
import { withMiddleware } from "@getstrata/core/http/routeMiddleware";
import { createScimThrottleMiddleware } from "@getstrata/core/http/scimThrottleMiddleware";
import { currentTenant } from "@getstrata/core/tenant/tenantContext";
import { getSql } from "../../bootstrap/database.ts";

const USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
const LIST_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
const ERROR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error";
const PATCH_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:PatchOp";
const CONFIG_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig";

type UserRow = { id: number; name: string; email: string };

function scimEnabled(): boolean {
  return (process.env.FEATURE_SCIM ?? "false") === "true";
}

function tenantId(): number {
  const tenant = currentTenant();
  if (!tenant) {
    throw new Error("SCIM requires a tenant context.");
  }
  return tenant.id;
}

function scimJson(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "content-type": "application/scim+json" },
  });
}

function scimError(detail: string, status: number): Response {
  return scimJson({ schemas: [ERROR_SCHEMA], detail, status: String(status) }, status);
}

function toScimUser(row: UserRow) {
  return {
    schemas: [USER_SCHEMA],
    id: String(row.id),
    userName: row.email,
    name: { formatted: row.name },
    emails: [{ value: row.email, primary: true }],
    active: true,
    meta: { resourceType: "User" },
  };
}

function readUserName(body: Record<string, unknown>): string {
  const emails = body.emails;
  if (Array.isArray(emails) && emails[0] && typeof emails[0] === "object") {
    const value = (emails[0] as { value?: unknown }).value;
    if (typeof value === "string" && value.trim()) {
      return value.trim().toLowerCase();
    }
  }
  return typeof body.userName === "string" ? body.userName.trim().toLowerCase() : "";
}

function readName(body: Record<string, unknown>, fallback: string): string {
  const name = body.name;
  if (name && typeof name === "object") {
    const formatted = (name as { formatted?: unknown; givenName?: unknown; familyName?: unknown })
      .formatted;
    if (typeof formatted === "string" && formatted.trim()) {
      return formatted.trim();
    }
    const given = (name as { givenName?: unknown }).givenName;
    const family = (name as { familyName?: unknown }).familyName;
    const combined = [given, family]
      .filter((part) => typeof part === "string")
      .join(" ")
      .trim();
    if (combined) {
      return combined;
    }
  }
  if (typeof body.displayName === "string" && body.displayName.trim()) {
    return body.displayName.trim();
  }
  return fallback;
}

function wrapScim(handler: (request: Request) => Promise<Response>) {
  const throttle = createScimThrottleMiddleware({
    redisUrl: process.env.REDIS_URL,
    maxAttempts: 120,
    decaySeconds: 60,
  });
  return withMiddleware(
    throttle,
    createScimAuthMiddleware(),
  )(
    withErrorHandling(async (request) => {
      if (!scimEnabled()) {
        return scimError("SCIM is off.", 404);
      }
      return handler(request);
    }),
  );
}

const scimModule: AppModule = {
  name: "scim",
  order: 8,
  routes({ kernel }) {
    return {
      "/scim/v2/ServiceProviderConfig": {
        GET: kernel.wrap(
          "api",
          wrapScim(async () =>
            scimJson({
              schemas: [CONFIG_SCHEMA],
              patch: { supported: true },
              bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
              filter: { supported: true, maxResults: 200 },
              changePassword: { supported: false },
              sort: { supported: false },
              etag: { supported: false },
              authenticationSchemes: [
                {
                  type: "oauthbearertoken",
                  name: "OAuth Bearer Token",
                  description: "Bearer token in the Authorization header.",
                  specUri: "https://www.rfc-editor.org/rfc/rfc6750",
                  primary: true,
                },
              ],
            }),
          ),
        ),
      },
      "/scim/v2/Users": {
        GET: kernel.wrap(
          "api",
          wrapScim(async (request) => {
            const url = new URL(request.url);
            const filter = url.searchParams.get("filter") ?? "";
            const match = /userName\s+eq\s+"([^"]+)"/i.exec(filter);
            let rows: UserRow[];
            if (match?.[1]) {
              rows = await getSql().unsafe<UserRow>(
                "SELECT id, name, email FROM users WHERE email = $1 AND tenant_id = $2",
                [match[1].trim().toLowerCase(), tenantId()],
              );
            } else {
              rows = await getSql().unsafe<UserRow>(
                "SELECT id, name, email FROM users WHERE tenant_id = $1",
                [tenantId()],
              );
            }
            const startIndex = Math.max(
              1,
              Number.parseInt(url.searchParams.get("startIndex") ?? "1", 10) || 1,
            );
            const count = Math.min(
              200,
              Math.max(
                1,
                Number.parseInt(url.searchParams.get("count") ?? String(rows.length || 1), 10) ||
                  200,
              ),
            );
            const slice = rows.slice(startIndex - 1, startIndex - 1 + count);
            return scimJson({
              schemas: [LIST_SCHEMA],
              totalResults: rows.length,
              startIndex,
              itemsPerPage: slice.length,
              Resources: slice.map(toScimUser),
            });
          }),
        ),
        POST: kernel.wrap(
          "api",
          wrapScim(async (request) => {
            const body = (await request.json()) as Record<string, unknown>;
            const email = readUserName(body);
            const name = readName(body, email.split("@")[0] ?? "User");
            if (!email) {
              return scimError("userName is required.", 400);
            }
            const existing = await getSql().unsafe<UserRow>(
              "SELECT id, name, email FROM users WHERE email = $1 AND tenant_id = $2",
              [email, tenantId()],
            );
            if (existing[0]) {
              return scimError("User already exists.", 409);
            }
            const hashed = await hashPassword(randomBytes(18).toString("hex"));
            await getSql().unsafe(
              "INSERT INTO users (name, email, password, is_admin, tenant_id) VALUES ($1, $2, $3, $4, $5)",
              [name, email, hashed, false, tenantId()],
            );
            const created = await getSql().unsafe<UserRow>(
              "SELECT id, name, email FROM users WHERE email = $1 AND tenant_id = $2",
              [email, tenantId()],
            );
            const row = created[0];
            if (!row) {
              return scimError("Could not create user.", 500);
            }
            return scimJson(toScimUser(row), 201);
          }),
        ),
      },
      "/scim/v2/Users/:id": {
        GET: kernel.wrap(
          "api",
          wrapScim(async (request) => {
            const id = Number.parseInt(routeParams(request).id ?? "", 10);
            const rows = await getSql().unsafe<UserRow>(
              "SELECT id, name, email FROM users WHERE id = $1 AND tenant_id = $2",
              [id, tenantId()],
            );
            const row = rows[0];
            if (!row) {
              return scimError("User not found.", 404);
            }
            return scimJson(toScimUser(row));
          }),
        ),
        PUT: kernel.wrap(
          "api",
          wrapScim(async (request) => {
            const id = Number.parseInt(routeParams(request).id ?? "", 10);
            const body = (await request.json()) as Record<string, unknown>;
            const email = readUserName(body);
            const name = readName(body, email);
            if (!email || !name) {
              return scimError("userName and name are required.", 400);
            }
            await getSql().unsafe(
              "UPDATE users SET name = $1, email = $2 WHERE id = $3 AND tenant_id = $4",
              [name, email, id, tenantId()],
            );
            const rows = await getSql().unsafe<UserRow>(
              "SELECT id, name, email FROM users WHERE id = $1 AND tenant_id = $2",
              [id, tenantId()],
            );
            const row = rows[0];
            if (!row) {
              return scimError("User not found.", 404);
            }
            return scimJson(toScimUser(row));
          }),
        ),
        PATCH: kernel.wrap(
          "api",
          wrapScim(async (request) => {
            const id = Number.parseInt(routeParams(request).id ?? "", 10);
            const existing = await getSql().unsafe<UserRow>(
              "SELECT id, name, email FROM users WHERE id = $1 AND tenant_id = $2",
              [id, tenantId()],
            );
            const row = existing[0];
            if (!row) {
              return scimError("User not found.", 404);
            }
            const body = (await request.json()) as {
              schemas?: string[];
              Operations?: Array<{ op?: string; path?: string; value?: unknown }>;
            };
            if (body.schemas && !body.schemas.includes(PATCH_SCHEMA)) {
              return scimError("Unsupported patch schema.", 400);
            }
            let name = row.name;
            let email = row.email;
            for (const operation of body.Operations ?? []) {
              const op = (operation.op ?? "replace").toLowerCase();
              if (op !== "replace" && op !== "add") {
                continue;
              }
              const path = (operation.path ?? "").toLowerCase();
              if (path === "username" || path === "emails") {
                email = String(operation.value ?? email)
                  .trim()
                  .toLowerCase();
              } else if (path === "name.formatted" || path === "displayname" || path === "name") {
                if (typeof operation.value === "string") {
                  name = operation.value.trim() || name;
                } else if (operation.value && typeof operation.value === "object") {
                  name = readName({ name: operation.value as Record<string, unknown> }, name);
                }
              } else if (!path && operation.value && typeof operation.value === "object") {
                const value = operation.value as Record<string, unknown>;
                email = readUserName(value) || email;
                name = readName(value, name);
              }
            }
            await getSql().unsafe(
              "UPDATE users SET name = $1, email = $2 WHERE id = $3 AND tenant_id = $4",
              [name, email, id, tenantId()],
            );
            return scimJson(toScimUser({ id: row.id, name, email }));
          }),
        ),
        DELETE: kernel.wrap(
          "api",
          wrapScim(async (request) => {
            const id = Number.parseInt(routeParams(request).id ?? "", 10);
            await getSql().unsafe("DELETE FROM users WHERE id = $1 AND tenant_id = $2", [
              id,
              tenantId(),
            ]);
            return new Response(null, { status: 204 });
          }),
        ),
      },
    };
  },
};

export default scimModule;
