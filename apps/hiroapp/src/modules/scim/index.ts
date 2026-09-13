import { randomBytes } from "node:crypto";
import type { AppModule } from "@getstrata/bootstrap/contracts";
import { routeParams } from "@getstrata/bootstrap/web/routing";
import { hashPassword } from "@getstrata/core/auth/password";
import { createScimAuthMiddleware } from "@getstrata/core/auth/scimAuthMiddleware";
import { BadRequestError } from "@getstrata/core/errors/http";
import { withErrorHandling } from "@getstrata/core/http/response";
import { withMiddleware } from "@getstrata/core/http/routeMiddleware";
import { createScimThrottleMiddleware } from "@getstrata/core/http/scimThrottleMiddleware";
import { parsePositiveIntParam } from "@getstrata/core/http/validation";
import { currentTenant } from "@getstrata/core/tenant/tenantContext";
import { User } from "../../models/User.ts";

const USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
const LIST_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
const ERROR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error";
const PATCH_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:PatchOp";
const CONFIG_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig";

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

function readScimUserId(request: Request): number | Response {
  try {
    return parsePositiveIntParam(routeParams(request).id ?? "", "id");
  } catch (error) {
    if (error instanceof BadRequestError) {
      return scimError("Invalid id.", 400);
    }
    throw error;
  }
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

function toScimUser(user: { get(key: "id" | "name" | "email"): unknown }) {
  const email = String(user.get("email") ?? "");
  const name = String(user.get("name") ?? "");
  return {
    schemas: [USER_SCHEMA],
    id: String(user.get("id")),
    userName: email,
    name: { formatted: name },
    emails: [{ value: email, primary: true }],
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
            const startIndex = Math.max(
              1,
              Number.parseInt(url.searchParams.get("startIndex") ?? "1", 10) || 1,
            );
            const count = Math.min(
              200,
              Math.max(1, Number.parseInt(url.searchParams.get("count") ?? "200", 10) || 200),
            );
            if (match?.[1]) {
              const email = match[1].trim().toLowerCase();
              const user = await User.where({ email, tenant_id: tenantId() }).first();
              const users = user ? [user] : [];
              const slice = users.slice(startIndex - 1, startIndex - 1 + count);
              return scimJson({
                schemas: [LIST_SCHEMA],
                totalResults: users.length,
                startIndex,
                itemsPerPage: slice.length,
                Resources: slice.map(toScimUser),
              });
            }
            const totalResults = await User.where({ tenant_id: tenantId() }).count();
            const page = await User.where({ tenant_id: tenantId() })
              .offset(startIndex - 1)
              .limit(count)
              .get();
            return scimJson({
              schemas: [LIST_SCHEMA],
              totalResults,
              startIndex,
              itemsPerPage: page.length,
              Resources: page.map(toScimUser),
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
            const existing = await User.where({ email, tenant_id: tenantId() }).first();
            if (existing) {
              return scimError("User already exists.", 409);
            }
            const hashed = await hashPassword(randomBytes(18).toString("hex"));
            const created = await User.create({
              name,
              email,
              password: hashed,
              is_admin: false,
              tenant_id: tenantId(),
            });
            if (!created) {
              return scimError("Could not create user.", 500);
            }
            return scimJson(toScimUser(created), 201);
          }),
        ),
      },
      "/scim/v2/Users/:id": {
        GET: kernel.wrap(
          "api",
          wrapScim(async (request) => {
            const id = readScimUserId(request);
            if (id instanceof Response) {
              return id;
            }
            const user = await User.where({ id, tenant_id: tenantId() }).first();
            if (!user) {
              return scimError("User not found.", 404);
            }
            return scimJson(toScimUser(user));
          }),
        ),
        PUT: kernel.wrap(
          "api",
          wrapScim(async (request) => {
            const id = readScimUserId(request);
            if (id instanceof Response) {
              return id;
            }
            const body = (await request.json()) as Record<string, unknown>;
            const email = readUserName(body);
            const name = readName(body, email);
            if (!email || !name) {
              return scimError("userName and name are required.", 400);
            }
            const user = await User.where({ id, tenant_id: tenantId() }).first();
            if (!user) {
              return scimError("User not found.", 404);
            }
            await user.update({ name, email });
            return scimJson(toScimUser(user));
          }),
        ),
        PATCH: kernel.wrap(
          "api",
          wrapScim(async (request) => {
            const id = readScimUserId(request);
            if (id instanceof Response) {
              return id;
            }
            const user = await User.where({ id, tenant_id: tenantId() }).first();
            if (!user) {
              return scimError("User not found.", 404);
            }
            const body = (await request.json()) as {
              schemas?: string[];
              Operations?: Array<{ op?: string; path?: string; value?: unknown }>;
            };
            if (body.schemas && !body.schemas.includes(PATCH_SCHEMA)) {
              return scimError("Unsupported patch schema.", 400);
            }
            let name = String(user.get("name") ?? "");
            let email = String(user.get("email") ?? "");
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
            await user.update({ name, email });
            return scimJson(toScimUser(user));
          }),
        ),
        DELETE: kernel.wrap(
          "api",
          wrapScim(async (request) => {
            const id = readScimUserId(request);
            if (id instanceof Response) {
              return id;
            }
            const user = await User.where({ id, tenant_id: tenantId() }).first();
            if (user) {
              await user.delete();
            }
            return new Response(null, { status: 204 });
          }),
        ),
      },
    };
  },
};

export default scimModule;
