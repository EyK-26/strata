import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runWithMigrationBypass } from "@getstrata/core/tenant/databaseTenantContext";
import { getDatabase } from "../../src/db/connection";
import { TEST_ADMIN_API_TOKEN, TEST_MEMBER_API_TOKEN } from "../../src/domain/auth";
import { TEST_SCIM_BEARER_TOKEN } from "../../src/domain/scim";
import { pinWorkhubIntegrationEnv } from "../helpers/integrationEnv";

const TEST_DATABASE_URL = process.env.DATABASE_URL;

if (!TEST_DATABASE_URL) {
  throw new Error("DATABASE_URL must be set before running integration tests.");
}

interface PaginationMeta {
  page: number;
  per_page: number;
  total: number;
  last_page: number;
}

interface PaginatedBody<T> {
  data: T[];
  meta: PaginationMeta;
}

let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;
let storageDirectory = "";

function api(pathname: string): string {
  return `${baseUrl}/api/v1${pathname}`;
}

function adminHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    authorization: `Bearer ${TEST_ADMIN_API_TOKEN}`,
    ...extra,
  };
}

function memberHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    authorization: `Bearer ${TEST_MEMBER_API_TOKEN}`,
    ...extra,
  };
}

async function fetchResourceEtag(
  pathname: string,
  headers?: Record<string, string>,
): Promise<string> {
  const response = await fetch(api(pathname), { headers });
  expect(response.status).toBe(200);
  const etag = response.headers.get("etag");
  expect(etag).toBeTruthy();
  return etag as string;
}

function withIfMatch(headers: Record<string, string>, etag: string): Record<string, string> {
  return {
    ...headers,
    "if-match": etag,
  };
}

function root(pathname: string): string {
  return `${baseUrl}${pathname}`;
}

async function getJson<T>(
  pathname: string,
  init?: RequestInit,
): Promise<{
  response: Response;
  body: T;
}> {
  const response = await fetch(api(pathname), init);
  return {
    response,
    body: (await response.json()) as T,
  };
}

beforeAll(async () => {
  mock.restore();
  pinWorkhubIntegrationEnv();
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.QUEUE_DRIVER = "sync";
  process.env.LOGIN_RATE_LIMIT_PER_WINDOW = "1000";
  storageDirectory = await mkdtemp(join(tmpdir(), "strata-routes-integration-"));
  process.env.STORAGE_PATH = storageDirectory;
  await rm(join(process.cwd(), "storage"), { recursive: true, force: true });

  const [{ freshDatabase }, { createAppDependencies }, { createRoutes }] = await Promise.all([
    import("../../src/db/migrations/runner"),
    import("../../src/bootstrap/dependencies"),
    import("../../src/bootstrap/createRoutes"),
  ]);

  await freshDatabase({ seed: true });

  server = Bun.serve({
    port: 0,
    routes: createRoutes(createAppDependencies()),
  });

  baseUrl = server.url.toString().replace(/\/$/, "");
});

afterAll(async () => {
  server.stop(true);
  if (storageDirectory) {
    await rm(storageDirectory, { recursive: true, force: true });
  }
});

describe("integration routes with postgres", () => {
  test("GET /health returns ok", async () => {
    const response = await fetch(root("/health"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  test("GET /ready reports database and redis checks", async () => {
    const response = await fetch(root("/ready"));
    const body = (await response.json()) as {
      status: string;
      checks: Record<string, string>;
    };

    expect(body.checks.database).toBe("ok");
    expect(body.status).toBe("ready");
  });

  test("GET /auth/me returns the bearer-authenticated user", async () => {
    const response = await fetch(api("/auth/me"), {
      headers: {
        authorization: `Bearer ${TEST_ADMIN_API_TOKEN}`,
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: 1,
      email: "admin@workhub.test",
      role: "admin",
    });
  });

  test("GET /auth/me returns 401 without credentials", async () => {
    const response = await fetch(api("/auth/me"));
    expect(response.status).toBe(401);
  });

  test("POST /auth/register succeeds when an existing webhook URL is blocked", async () => {
    await runWithMigrationBypass(async () => {
      await getDatabase()`
        INSERT INTO webhook (organization_id, tenant_id, url, secret, events, active, created_at)
        VALUES (
          NULL,
          1,
          ${"http://127.0.0.1/hook"},
          ${"whsec_blocked_register"},
          ${["*"]},
          TRUE,
          NOW()
        )
      `;
    });

    const email = `blocked-hook-${Date.now()}@workhub.test`;
    const response = await fetch(api("/auth/register"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Blocked Hook User",
        email,
        password: "password123",
        password_confirmation: "password123",
      }),
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as { token: string; user: { email: string } };
    expect(body.token).toBeTruthy();
    expect(body.user.email).toBe(email);
  });

  test("POST /auth/tokens creates a revocable bearer token", async () => {
    const createResponse = await fetch(api("/auth/tokens"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${TEST_ADMIN_API_TOKEN}`,
      },
      body: JSON.stringify({
        name: "integration-token",
        abilities: ["*"],
      }),
    });

    expect(createResponse.status).toBe(201);
    const body = (await createResponse.json()) as {
      id: number;
      token: string;
      name: string;
    };

    expect(body.name).toBe("integration-token");
    expect(body.token.length).toBeGreaterThan(20);

    const meResponse = await fetch(api("/auth/me"), {
      headers: { authorization: `Bearer ${body.token}` },
    });
    expect(meResponse.status).toBe(200);

    const deleteResponse = await fetch(api(`/auth/tokens/${body.id}`), {
      method: "DELETE",
      headers: { authorization: `Bearer ${body.token}` },
    });
    expect(deleteResponse.status).toBe(204);
  });

  test("DELETE /projects/:id returns 403 when token lacks delete ability", async () => {
    const createTokenResponse = await fetch(api("/auth/tokens"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${TEST_ADMIN_API_TOKEN}`,
      },
      body: JSON.stringify({
        name: "read-only-projects",
        abilities: ["projects:read"],
      }),
    });

    expect(createTokenResponse.status).toBe(201);
    const tokenBody = (await createTokenResponse.json()) as {
      id: number;
      token: string;
    };

    const createProjectResponse = await fetch(api("/projects"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...adminHeaders(),
      },
      body: JSON.stringify({
        organization_id: 1,
        name: "Ability Guard Project",
        status: "draft",
      }),
    });

    expect(createProjectResponse.status).toBe(201);
    const project = (await createProjectResponse.json()) as { id: number };

    const deleteResponse = await fetch(api(`/projects/${project.id}`), {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${tokenBody.token}`,
      },
    });

    expect(deleteResponse.status).toBe(403);

    await fetch(api(`/auth/tokens/${tokenBody.id}`), {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${TEST_ADMIN_API_TOKEN}`,
      },
    });
  });

  test("DELETE /projects/:id accepts database-backed bearer tokens", async () => {
    const createResponse = await fetch(api("/projects"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...adminHeaders(),
      },
      body: JSON.stringify({
        organization_id: 1,
        name: "Bearer Auth Project",
        status: "draft",
      }),
    });

    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as { id: number };

    const guestDeleteResponse = await fetch(api(`/projects/${created.id}`), {
      method: "DELETE",
    });
    expect(guestDeleteResponse.status).toBe(401);

    const memberDeleteResponse = await fetch(api(`/projects/${created.id}`), {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${TEST_MEMBER_API_TOKEN}`,
      },
    });
    expect(memberDeleteResponse.status).toBe(403);

    const adminDeleteResponse = await fetch(api(`/projects/${created.id}`), {
      method: "DELETE",
      headers: withIfMatch(
        adminHeaders(),
        await fetchResourceEtag(`/projects/${created.id}`, adminHeaders()),
      ),
    });
    expect(adminDeleteResponse.status).toBe(204);
  });

  test("GET /organizations returns paginated seeded organizations", async () => {
    const { response, body } =
      await getJson<PaginatedBody<{ id: number; slug: string; name: string }>>("/organizations");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("x-request-id")).toBeTruthy();
    expect(body.data.length).toBeGreaterThanOrEqual(2);
    expect(body.meta).toMatchObject({
      page: 1,
      per_page: 15,
      total: body.data.length,
      last_page: 1,
    });
    expect(body.data[0]).toMatchObject({
      id: 1,
      slug: "acme-labs",
      name: "Acme Labs",
    });
  });

  test("GET /organizations returns ETag and honors If-None-Match", async () => {
    const first = await fetch(api("/organizations"));
    expect(first.status).toBe(200);
    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();

    const second = await fetch(api("/organizations"), {
      headers: { "if-none-match": etag ?? "" },
    });
    expect(second.status).toBe(304);
    expect(second.headers.get("etag")).toBe(etag);
  });

  test("GET /organizations/:id returns ETag and honors If-None-Match", async () => {
    const first = await fetch(api("/organizations/1"));
    expect(first.status).toBe(200);
    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();

    const second = await fetch(api("/organizations/1"), {
      headers: { "if-none-match": etag ?? "" },
    });
    expect(second.status).toBe(304);
  });

  test("PATCH /organizations/:id requires If-Match header", async () => {
    const patchResponse = await fetch(api("/organizations/1"), {
      method: "PATCH",
      headers: {
        ...adminHeaders(),
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "Acme Labs" }),
    });

    expect(patchResponse.status).toBe(412);
    expect(await patchResponse.json()).toEqual({
      error: "If-Match header is required.",
    });
  });

  test("PATCH /organizations/:id rejects stale If-Match with 412", async () => {
    const showResponse = await fetch(api("/organizations/1"));
    expect(showResponse.status).toBe(200);

    const patchResponse = await fetch(api("/organizations/1"), {
      method: "PATCH",
      headers: {
        ...adminHeaders(),
        "content-type": "application/json",
        "if-match": 'W/"stale-etag"',
      },
      body: JSON.stringify({ name: "Acme Labs Updated" }),
    });

    expect(patchResponse.status).toBe(412);
    expect(await patchResponse.json()).toEqual({
      error: "Resource ETag does not match If-Match.",
    });
  });

  test("PATCH /organizations/:id succeeds with matching If-Match", async () => {
    const showResponse = await fetch(api("/organizations/1"));
    const etag = showResponse.headers.get("etag");
    expect(etag).toBeTruthy();

    const patchResponse = await fetch(api("/organizations/1"), {
      method: "PATCH",
      headers: {
        ...adminHeaders(),
        "content-type": "application/json",
        "if-match": etag ?? "",
      },
      body: JSON.stringify({ name: "Acme Labs" }),
    });

    expect(patchResponse.status).toBe(200);
  });

  test("GET /organizations supports page and per_page query params", async () => {
    const { response, body } = await getJson<PaginatedBody<{ id: number; slug: string }>>(
      "/organizations?per_page=1&page=2",
    );

    expect(response.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.meta).toMatchObject({
      page: 2,
      per_page: 1,
      total: body.meta.total,
      last_page: body.meta.total,
    });
  });

  test("GET /organizations returns 400 for invalid query params", async () => {
    const { response, body } = await getJson<{ error: string }>("/organizations?per_page=0");

    expect(response.status).toBe(400);
    expect(body).toEqual({
      error: 'Invalid query parameter "per_page". Expected a positive integer.',
    });
  });

  test("GET /organizations/:id returns 404 for missing rows", async () => {
    const { response, body } = await getJson<{ error: string }>("/organizations/9999");

    expect(response.status).toBe(404);
    expect(body).toEqual({
      error: "Organization 9999 not found.",
    });
  });

  test("POST /organizations returns 401 without credentials", async () => {
    const response = await fetch(api("/organizations"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Unauthorized Org",
        slug: "unauthorized-org",
      }),
    });

    expect(response.status).toBe(401);
  });

  test("POST /organizations returns 422 for invalid payloads", async () => {
    const response = await fetch(api("/organizations"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...adminHeaders(),
      },
      body: JSON.stringify({
        name: "",
        slug: "Bad Slug",
      }),
    });

    expect(response.status).toBe(422);
    const body = (await response.json()) as {
      error: string;
      details: Record<string, string[]>;
    };
    expect(body.error).toBe("The given data was invalid.");
    expect(body.details.name).toContain('"name" is required.');
    expect(body.details.slug).toContain('"slug" has an invalid format.');
  });

  test("POST /organizations creates an organization", async () => {
    const before = await getJson<PaginatedBody<{ slug: string }>>("/organizations");
    const initialTotal = before.body.meta.total;

    const response = await fetch(api("/organizations"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...adminHeaders(),
      },
      body: JSON.stringify({
        name: "Stellar Forge",
        slug: "stellar-forge",
      }),
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as { slug: string; name: string };
    expect(body).toMatchObject({
      slug: "stellar-forge",
      name: "Stellar Forge",
    });

    const after = await getJson<PaginatedBody<{ slug: string }>>("/organizations");
    expect(after.body.meta.total).toBe(initialTotal + 1);
    expect(after.body.data.some((organization) => organization.slug === "stellar-forge")).toBe(
      true,
    );
  });

  test("POST /organizations lets a registered member create an extra organization", async () => {
    const email = `api-member-org-${Date.now()}@workhub.test`;
    const register = await fetch(api("/auth/register"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "API Member Org Creator",
        email,
        password: "password123",
        password_confirmation: "password123",
      }),
    });
    expect(register.status).toBe(201);
    const registered = (await register.json()) as { token: string };
    expect(registered.token).toBeTruthy();

    const slug = `api-member-extra-${Date.now()}`;
    const response = await fetch(api("/organizations"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${registered.token}`,
      },
      body: JSON.stringify({
        name: "API Member Extra Org",
        slug,
      }),
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as { slug: string; name: string };
    expect(body).toMatchObject({
      slug,
      name: "API Member Extra Org",
    });
  });

  test("POST /auth/tokens scopes abilities to the granter token", async () => {
    const email = `api-token-scope-${Date.now()}@workhub.test`;
    const register = await fetch(api("/auth/register"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Token Scope Member",
        email,
        password: "password123",
        password_confirmation: "password123",
      }),
    });
    expect(register.status).toBe(201);
    const registered = (await register.json()) as { token: string };

    const response = await fetch(api("/auth/tokens"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${registered.token}`,
      },
      body: JSON.stringify({
        name: `scoped-child-${Date.now()}`,
        abilities: ["projects:read", "organizations:delete"],
      }),
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as { abilities: string[] };
    expect(body.abilities).toEqual(["projects:read"]);
  });

  test("organization invitations can be created, listed, accepted, and cancelled", async () => {
    const email = `api-invite-${Date.now()}@workhub.test`;
    const create = await fetch(api("/organizations/1/invitations"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...adminHeaders(),
      },
      body: JSON.stringify({ email, role: "member" }),
    });
    expect(create.status).toBe(201);
    const invitation = (await create.json()) as { id: number; email: string };
    expect(invitation.email).toBe(email);

    const listed = await fetch(api("/organizations/1/invitations"), {
      headers: adminHeaders(),
    });
    expect(listed.status).toBe(200);
    const listBody = (await listed.json()) as { data: Array<{ id: number; email: string }> };
    expect(listBody.data.some((row) => row.id === invitation.id)).toBe(true);

    const cancelled = await fetch(api(`/organizations/1/invitations/${invitation.id}`), {
      method: "DELETE",
      headers: adminHeaders(),
    });
    expect(cancelled.status).toBe(204);

    const register = await fetch(api("/auth/register"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "API Invitee",
        email,
        password: "password123",
        password_confirmation: "password123",
      }),
    });
    expect(register.status).toBe(201);
    const registered = (await register.json()) as { token: string };

    const reinvite = await fetch(api("/organizations/1/invitations"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...adminHeaders(),
      },
      body: JSON.stringify({ email, role: "admin" }),
    });
    expect(reinvite.status).toBe(201);

    const { hashApiToken } = await import("@getstrata/core/auth/tokenHash");
    const token = "integration-invite-token";
    await runWithMigrationBypass(async () => {
      await getDatabase()`
        UPDATE organization_invitation
        SET token_hash = ${hashApiToken(token)}
        WHERE email = ${email}
      `;
    });

    const accepted = await fetch(api("/invitations/accept"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${registered.token}`,
      },
      body: JSON.stringify({ token }),
    });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({
      organization_id: 1,
      role: "admin",
    });
  });

  test("POST /organizations returns 409 for duplicate slugs", async () => {
    const response = await fetch(api("/organizations"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...adminHeaders(),
      },
      body: JSON.stringify({
        name: "Duplicate Acme",
        slug: "acme-labs",
      }),
    });

    expect(response.status).toBe(409);
  });

  test("GET /projects?include=organization embeds parent organization", async () => {
    const { response, body } = await getJson<
      PaginatedBody<{
        name: string;
        organization?: { slug: string };
      }>
    >("/projects?include=organization&organizationId=1");

    expect(response.status).toBe(200);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    expect(body.data[0]?.organization).toMatchObject({
      slug: "acme-labs",
    });
  });

  test("POST /projects returns 404 when organization does not exist", async () => {
    const response = await fetch(api("/projects"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...adminHeaders(),
      },
      body: JSON.stringify({
        organization_id: 9999,
        name: "Ghost Project",
      }),
    });

    expect(response.status).toBe(404);
  });

  test("GET /tasks returns paginated seeded tasks", async () => {
    const { response, body } = await getJson<PaginatedBody<{ title: string }>>("/tasks");

    expect(response.status).toBe(200);
    expect(body.data.length).toBeGreaterThanOrEqual(4);
    expect(body.data[0]).toMatchObject({
      title: "Design module registry",
    });
  });

  test("POST /tasks creates a task for an existing project", async () => {
    const response = await fetch(api("/tasks"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...adminHeaders(),
      },
      body: JSON.stringify({
        project_id: 2,
        title: "Write migration guide",
        status: "todo",
        priority: 2,
      }),
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as { title: string; project_id: number };
    expect(body).toMatchObject({
      title: "Write migration guide",
      project_id: 2,
    });
  });

  test("GET /tasks/:id/comments returns paginated comments for a task", async () => {
    const { response, body } = await getJson<PaginatedBody<{ body: string }>>("/tasks/1/comments");

    expect(response.status).toBe(200);
    expect(body.data.length).toBeGreaterThanOrEqual(2);
    expect(body.data[0]?.body).toContain("Registry");
  });

  test("POST /tasks/:id/comments creates a nested comment", async () => {
    const response = await fetch(api("/tasks/2/comments"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...adminHeaders(),
      },
      body: JSON.stringify({
        body: "Query builder supports belongsTo eager loads.",
      }),
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as { task_id: number; body: string };
    expect(body).toMatchObject({
      task_id: 2,
      body: "Query builder supports belongsTo eager loads.",
    });
  });

  test("POST /tasks/:id/attachments uploads a file and GET download returns bytes", async () => {
    const payload = "attachment-bytes-check";
    const formData = new FormData();
    formData.append(
      "file",
      new File([new TextEncoder().encode(payload)], "notes.txt", { type: "text/plain" }),
    );

    const uploadResponse = await fetch(api("/tasks/1/attachments"), {
      method: "POST",
      headers: adminHeaders(),
      body: formData,
    });

    expect(uploadResponse.status).toBe(201);
    const uploaded = (await uploadResponse.json()) as {
      id: number;
      original_name: string;
      mime_type: string;
    };
    expect(uploaded.original_name).toBe("notes.txt");
    expect(uploaded.mime_type).toBe("text/plain");

    const listResponse = await getJson<PaginatedBody<{ id: number }>>("/tasks/1/attachments", {
      headers: adminHeaders(),
    });
    expect(listResponse.body.data.some((item) => item.id === uploaded.id)).toBe(true);

    const downloadResponse = await fetch(api(`/attachments/${uploaded.id}/download`), {
      headers: adminHeaders(),
    });
    expect(downloadResponse.status).toBe(200);
    expect(await downloadResponse.text()).toBe("attachment-bytes-check");
  });

  test("DELETE /attachments/:id removes an uploaded file", async () => {
    const formData = new FormData();
    formData.append("file", new File(["temporary"], "temp.txt", { type: "text/plain" }));

    const uploadResponse = await fetch(api("/tasks/1/attachments"), {
      method: "POST",
      headers: adminHeaders(),
      body: formData,
    });
    const uploaded = (await uploadResponse.json()) as { id: number };

    const deleteResponse = await fetch(api(`/attachments/${uploaded.id}`), {
      method: "DELETE",
      headers: adminHeaders(),
    });
    expect(deleteResponse.status).toBe(204);

    const listResponse = await getJson<PaginatedBody<{ id: number }>>("/tasks/1/attachments", {
      headers: {
        ...adminHeaders(),
        "cache-control": "no-cache",
      },
    });
    expect(listResponse.body.data.some((item) => item.id === uploaded.id)).toBe(false);
  });

  test("GET /reports/summary returns cross-module counts", async () => {
    const { response, body } = await getJson<{
      organization_count: number;
      task_count: number;
      projects_by_status: Record<string, number>;
    }>("/reports/summary", { headers: adminHeaders() });

    expect(response.status).toBe(200);
    expect(body.organization_count).toBeGreaterThanOrEqual(2);
    expect(body.task_count).toBeGreaterThanOrEqual(4);
    expect(body.projects_by_status.active).toBeGreaterThanOrEqual(1);
  });

  test("GET /reports/organizations/:id returns organization breakdown", async () => {
    const { response, body } = await getJson<{
      organization: { slug: string };
      project_count: number;
      task_count: number;
    }>("/reports/organizations/1", { headers: adminHeaders() });

    expect(response.status).toBe(200);
    expect(body.organization.slug).toBe("acme-labs");
    expect(body.project_count).toBeGreaterThanOrEqual(2);
    expect(body.task_count).toBeGreaterThanOrEqual(2);
  });

  test("DELETE /organizations/:id soft deletes the record", async () => {
    const createResponse = await fetch(api("/organizations"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...adminHeaders(),
      },
      body: JSON.stringify({
        name: "Soft Delete Co",
        slug: "soft-delete-co",
      }),
    });

    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as { id: number };

    const deleteResponse = await fetch(api(`/organizations/${created.id}`), {
      method: "DELETE",
      headers: withIfMatch(
        adminHeaders(),
        await fetchResourceEtag(`/organizations/${created.id}`, adminHeaders()),
      ),
    });

    expect(deleteResponse.status).toBe(204);

    const showResponse = await fetch(api(`/organizations/${created.id}`));
    expect(showResponse.status).toBe(404);

    const { body } = await getJson<PaginatedBody<{ slug: string }>>("/organizations");
    expect(body.data.some((organization) => organization.slug === "soft-delete-co")).toBe(false);
  });

  test("DELETE /organizations/:id requires If-Match header", async () => {
    const createResponse = await fetch(api("/organizations"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...adminHeaders(),
      },
      body: JSON.stringify({
        name: "If-Match Required Co",
        slug: "if-match-required-co",
      }),
    });

    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as { id: number };

    const deleteResponse = await fetch(api(`/organizations/${created.id}`), {
      method: "DELETE",
      headers: adminHeaders(),
    });

    expect(deleteResponse.status).toBe(412);
    expect(await deleteResponse.json()).toEqual({
      error: "If-Match header is required.",
    });
  });

  test("DELETE /organizations/:id enforces protected organization policy", async () => {
    const createResponse = await fetch(api("/organizations"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...adminHeaders(),
      },
      body: JSON.stringify({
        name: "Protected Org",
        slug: "protected-org",
      }),
    });

    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as { id: number };

    const guestDeleteResponse = await fetch(api(`/organizations/${created.id}`), {
      method: "DELETE",
    });

    expect(guestDeleteResponse.status).toBe(401);

    const adminDeleteResponse = await fetch(api(`/organizations/${created.id}`), {
      method: "DELETE",
      headers: withIfMatch(
        {
          "x-authenticated-user-id": "1",
          "x-authenticated-user-role": "admin",
        },
        await fetchResourceEtag(`/organizations/${created.id}`, adminHeaders()),
      ),
    });

    expect(adminDeleteResponse.status).toBe(204);

    const showResponse = await fetch(api(`/organizations/${created.id}`));
    expect(showResponse.status).toBe(404);
  });

  test("DELETE /projects/:id returns 401 for unauthenticated requests", async () => {
    const response = await fetch(api("/projects/1"), {
      method: "DELETE",
    });

    expect(response.status).toBe(401);
  });

  test("GET /reports/summary excludes soft-deleted organizations", async () => {
    const before = await getJson<{ organization_count: number }>("/reports/summary", {
      headers: adminHeaders(),
    });

    const createResponse = await fetch(api("/organizations"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...adminHeaders(),
      },
      body: JSON.stringify({
        name: "Report Exclusion Co",
        slug: "report-exclusion-co",
      }),
    });

    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as { id: number };

    const afterCreate = await getJson<{ organization_count: number }>("/reports/summary", {
      headers: adminHeaders(),
    });
    expect(afterCreate.body.organization_count).toBe(before.body.organization_count + 1);

    const deleteResponse = await fetch(api(`/organizations/${created.id}`), {
      method: "DELETE",
      headers: withIfMatch(
        adminHeaders(),
        await fetchResourceEtag(`/organizations/${created.id}`, adminHeaders()),
      ),
    });
    expect(deleteResponse.status).toBe(204);

    const afterDelete = await getJson<{ organization_count: number }>("/reports/summary", {
      headers: adminHeaders(),
    });
    expect(afterDelete.body.organization_count).toBe(before.body.organization_count);

    const orgReportResponse = await fetch(api(`/reports/organizations/${created.id}`), {
      headers: adminHeaders(),
    });
    expect(orgReportResponse.status).toBe(404);
  });

  test("GET /admin/stats returns platform counts for admin tokens", async () => {
    const response = await fetch(api("/admin/stats"), {
      headers: adminHeaders(),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      user_count: number;
      organization_count: number;
    };
    expect(body.user_count).toBeGreaterThanOrEqual(2);
    expect(body.organization_count).toBeGreaterThanOrEqual(2);
  });

  test("GET /admin/stats returns 403 for member tokens", async () => {
    const response = await fetch(api("/admin/stats"), {
      headers: memberHeaders(),
    });

    expect(response.status).toBe(403);
  });

  test("POST /projects returns 404 when member targets organization outside membership", async () => {
    const response = await fetch(api("/projects"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...memberHeaders(),
      },
      body: JSON.stringify({
        organization_id: 2,
        name: "Cross Org Project",
      }),
    });

    expect(response.status).toBe(404);
  });

  test("POST /tasks returns 404 when member targets project outside membership", async () => {
    const response = await fetch(api("/tasks"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...memberHeaders(),
      },
      body: JSON.stringify({
        project_id: 3,
        title: "Cross Org Task",
      }),
    });

    expect(response.status).toBe(404);
  });

  test("GET /search returns results when feature is enabled", async () => {
    const response = await fetch(api("/search?q=Registry"), {
      headers: adminHeaders(),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: unknown[] };
    expect(body.data.length).toBeGreaterThanOrEqual(1);
  });

  test("GET /audit-logs returns entries for admin tokens when enabled", async () => {
    const response = await fetch(api("/audit-logs"), {
      headers: adminHeaders(),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  });

  test("GET /webhooks returns list for admin tokens when enabled", async () => {
    const response = await fetch(api("/webhooks"), {
      headers: adminHeaders(),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  });

  test("GET /billing/subscription returns tenant subscription when enabled", async () => {
    const response = await fetch(api("/billing/subscription"), {
      headers: adminHeaders(),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      tenant_id: number;
      subscription: { plan: string } | null;
    };
    expect(body.tenant_id).toBe(1);
  });

  test("guest can read project show routes for hobby/demo mode", async () => {
    const response = await fetch(api("/projects/1"));
    expect(response.status).toBe(200);
  });

  test("member receives 403 when showing organizations outside membership", async () => {
    const response = await fetch(api("/organizations/2"), {
      headers: memberHeaders(),
    });

    expect(response.status).toBe(403);
  });

  test("member receives 404 when showing projects outside membership", async () => {
    const response = await fetch(api("/projects/3"), {
      headers: memberHeaders(),
    });

    expect(response.status).toBe(404);
  });

  test("member can show organizations within membership", async () => {
    const response = await fetch(api("/organizations/1"), {
      headers: memberHeaders(),
    });

    expect(response.status).toBe(200);
  });

  test("member scoped list excludes organizations outside membership", async () => {
    const { response, body } = await getJson<PaginatedBody<{ id: number }>>("/organizations", {
      headers: memberHeaders(),
    });

    expect(response.status).toBe(200);
    expect(body.data.some((organization) => organization.id === 2)).toBe(false);
    expect(body.data.some((organization) => organization.id === 1)).toBe(true);
  });

  test("member cannot spoof x-tenant-id header", async () => {
    const response = await fetch(api("/auth/me"), {
      headers: memberHeaders({ "x-tenant-id": "2" }),
    });

    expect(response.status).toBe(403);
  });

  test("cross-tenant resources return 404 for members in another tenant", async () => {
    const createResponse = await fetch(api("/organizations"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...adminHeaders({ "x-tenant-id": "2" }),
      },
      body: JSON.stringify({
        name: "Tenant Two Org",
        slug: "tenant-two-org",
      }),
    });

    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as { id: number };

    const memberResponse = await fetch(api(`/organizations/${created.id}`), {
      headers: memberHeaders(),
    });

    expect(memberResponse.status).toBe(404);
  });

  test("JSON MFA setup, confirm, rotate, and disable work for a disposable user", async () => {
    const { generateTotp } = await import("@getstrata/core/security/totp");
    const email = `json-mfa-${Date.now()}@workhub.test`;
    const registerResponse = await fetch(api("/auth/register"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Json Mfa User",
        email,
        password: "password123",
        password_confirmation: "password123",
      }),
    });
    expect(registerResponse.status).toBe(201);
    const registered = (await registerResponse.json()) as { token: string };
    const headers = {
      authorization: `Bearer ${registered.token}`,
      "content-type": "application/json",
    };

    const setup = await fetch(api("/users/me/mfa"), { method: "POST", headers });
    expect(setup.status).toBe(200);
    const setupBody = (await setup.json()) as { secret: string; otpauth_url: string };
    expect(setupBody.secret.length).toBeGreaterThan(10);
    expect(setupBody.otpauth_url).toContain("otpauth://totp/");

    const confirmed = await fetch(api("/users/me/mfa/confirm"), {
      method: "POST",
      headers,
      body: JSON.stringify({
        mfa_code: generateTotp(setupBody.secret, Math.floor(Date.now() / 30_000)),
      }),
    });
    expect(confirmed.status).toBe(200);
    const confirmedBody = (await confirmed.json()) as { recovery_codes: string[] };
    expect(confirmedBody.recovery_codes).toHaveLength(8);

    const rotated = await fetch(api("/users/me/mfa/recovery-codes"), {
      method: "POST",
      headers,
      body: JSON.stringify({ password: "password123" }),
    });
    expect(rotated.status).toBe(200);
    const rotatedBody = (await rotated.json()) as { recovery_codes: string[] };
    expect(rotatedBody.recovery_codes).toHaveLength(8);
    expect(rotatedBody.recovery_codes).not.toEqual(confirmedBody.recovery_codes);

    const disabled = await fetch(api("/users/me/mfa"), {
      method: "DELETE",
      headers,
      body: JSON.stringify({ password: "password123" }),
    });
    expect(disabled.status).toBe(200);

    const unauthorized = await fetch(api("/users/me/mfa"), { method: "POST" });
    expect(unauthorized.status).toBe(401);
  });

  test("POST /auth/login without an MFA code completes via /auth/two-factor-challenge", async () => {
    const previousMfa = process.env.FEATURE_MFA;
    process.env.FEATURE_MFA = "true";
    const { generateTotp } = await import("@getstrata/core/security/totp");
    const email = `json-mfa-challenge-${Date.now()}@workhub.test`;

    try {
      const registerResponse = await fetch(api("/auth/register"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Json Mfa Challenge",
          email,
          password: "password123",
          password_confirmation: "password123",
        }),
      });
      expect(registerResponse.status).toBe(201);
      const registered = (await registerResponse.json()) as { token: string };
      const headers = {
        authorization: `Bearer ${registered.token}`,
        "content-type": "application/json",
      };

      const setup = await fetch(api("/users/me/mfa"), { method: "POST", headers });
      expect(setup.status).toBe(200);
      const setupBody = (await setup.json()) as { secret: string };
      const confirmed = await fetch(api("/users/me/mfa/confirm"), {
        method: "POST",
        headers,
        body: JSON.stringify({
          mfa_code: generateTotp(setupBody.secret, Math.floor(Date.now() / 30_000)),
        }),
      });
      expect(confirmed.status).toBe(200);

      const challenged = await fetch(api("/auth/login"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          password: "password123",
        }),
      });
      expect(challenged.status).toBe(401);
      const challengeBody = (await challenged.json()) as {
        two_factor: boolean;
        mfa_pending: string;
      };
      expect(challengeBody.two_factor).toBe(true);
      expect(challengeBody.mfa_pending).toBeTruthy();

      const completed = await fetch(api("/auth/two-factor-challenge"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: generateTotp(setupBody.secret, Math.floor(Date.now() / 30_000)),
          mfa_pending: challengeBody.mfa_pending,
        }),
      });
      expect(completed.status).toBe(201);
      const completedBody = (await completed.json()) as { token: string; user: { email: string } };
      expect(completedBody.token).toBeTruthy();
      expect(completedBody.user.email).toBe(email);
    } finally {
      if (previousMfa === undefined) {
        delete process.env.FEATURE_MFA;
      } else {
        process.env.FEATURE_MFA = previousMfa;
      }
    }
  });

  test("PATCH /users/me updates a disposable user without touching admin", async () => {
    const email = `json-profile-${Date.now()}@workhub.test`;
    const registerResponse = await fetch(api("/auth/register"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Json Profile User",
        email,
        password: "password123",
        password_confirmation: "password123",
      }),
    });
    expect(registerResponse.status).toBe(201);
    const registered = (await registerResponse.json()) as { token: string; user: { id: number } };
    expect(registered.token).toBeTruthy();

    const updated = await fetch(api("/users/me"), {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${registered.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "Renamed Json User",
        email,
      }),
    });
    expect(updated.status).toBe(200);
    const body = (await updated.json()) as {
      user: { name: string; email: string };
      email_changed: boolean;
    };
    expect(body.user.name).toBe("Renamed Json User");
    expect(body.user.email).toBe(email);
    expect(body.email_changed).toBe(false);

    const taken = await fetch(api("/users/me"), {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${registered.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "Renamed Json User",
        email: "admin@workhub.test",
      }),
    });
    expect(taken.status).toBe(422);
    const errors = (await taken.json()) as { error: string };
    expect(errors.error).toContain("already exists");

    const admin = await fetch(api("/auth/me"), {
      headers: adminHeaders(),
    });
    expect(admin.status).toBe(200);
    expect(((await admin.json()) as { email: string }).email).toBe("admin@workhub.test");
  });

  test("PUT /users/me/password and confirm-password work for a disposable user", async () => {
    const email = `json-password-${Date.now()}@workhub.test`;
    const registerResponse = await fetch(api("/auth/register"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Json Password User",
        email,
        password: "password123",
        password_confirmation: "password123",
      }),
    });
    expect(registerResponse.status).toBe(201);
    const registered = (await registerResponse.json()) as { token: string };
    const headers = {
      authorization: `Bearer ${registered.token}`,
      "content-type": "application/json",
    };

    const statusBefore = await fetch(api("/users/me/confirmed-password-status"), { headers });
    expect(statusBefore.status).toBe(200);
    expect(await statusBefore.json()).toEqual({ confirmed: false });

    const confirmed = await fetch(api("/users/me/confirm-password"), {
      method: "POST",
      headers,
      body: JSON.stringify({ password: "password123" }),
    });
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toEqual({ confirmed: true });
    const confirmCookie = confirmed.headers.get("set-cookie") ?? "";
    expect(confirmCookie).toContain("workhub_password_confirmed=");

    const statusAfter = await fetch(api("/users/me/confirmed-password-status"), {
      headers: { ...headers, cookie: confirmCookie },
    });
    expect(statusAfter.status).toBe(200);
    expect(await statusAfter.json()).toEqual({ confirmed: true });

    const wrong = await fetch(api("/users/me/password"), {
      method: "PUT",
      headers,
      body: JSON.stringify({
        current_password: "wrong-password",
        password: "newer-password",
        password_confirmation: "newer-password",
      }),
    });
    expect(wrong.status).toBe(422);

    const updated = await fetch(api("/users/me/password"), {
      method: "PUT",
      headers,
      body: JSON.stringify({
        current_password: "password123",
        password: "newer-password",
        password_confirmation: "newer-password",
      }),
    });
    expect(updated.status).toBe(200);
    const updatedBody = (await updated.json()) as { user: { email: string } };
    expect(updatedBody.user.email).toBe(email);

    const login = await fetch(api("/auth/login"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email,
        password: "newer-password",
      }),
    });
    expect(login.status).toBe(201);
    const loggedIn = (await login.json()) as { token: string };
    const extra = await fetch(api("/auth/tokens"), {
      method: "POST",
      headers: {
        authorization: `Bearer ${loggedIn.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "other-device", abilities: ["*"] }),
    });
    expect(extra.status).toBe(201);
    const extraBody = (await extra.json()) as { token: string };

    const loggedOut = await fetch(api("/users/me/logout-other-devices"), {
      method: "POST",
      headers: {
        authorization: `Bearer ${loggedIn.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ password: "newer-password" }),
    });
    expect(loggedOut.status).toBe(200);
    const loggedOutBody = (await loggedOut.json()) as { revoked: number };
    expect(loggedOutBody.revoked).toBeGreaterThanOrEqual(1);

    const stale = await fetch(api("/auth/me"), {
      headers: { authorization: `Bearer ${extraBody.token}` },
    });
    expect(stale.status).toBe(401);

    const stillCurrent = await fetch(api("/auth/me"), {
      headers: { authorization: `Bearer ${loggedIn.token}` },
    });
    expect(stillCurrent.status).toBe(200);
  });

  test("POST /users/me/photo uploads and DELETE removes a Jetstream profile photo", async () => {
    const email = `json-photo-${Date.now()}@workhub.test`;
    const registerResponse = await fetch(api("/auth/register"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Json Photo User",
        email,
        password: "password123",
        password_confirmation: "password123",
      }),
    });
    expect(registerResponse.status).toBe(201);
    const registered = (await registerResponse.json()) as { token: string };
    const png = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      ),
      (char) => char.charCodeAt(0),
    );
    const formData = new FormData();
    formData.append("photo", new File([png], "avatar.png", { type: "image/png" }));

    const uploaded = await fetch(api("/users/me/photo"), {
      method: "POST",
      headers: { authorization: `Bearer ${registered.token}` },
      body: formData,
    });
    expect(uploaded.status).toBe(200);
    expect(await uploaded.json()).toEqual({ photo_url: "/api/v1/users/me/photo" });

    const shown = await fetch(api("/users/me/photo"), {
      headers: { authorization: `Bearer ${registered.token}` },
    });
    expect(shown.status).toBe(200);
    expect(shown.headers.get("content-type")).toBe("image/png");
    expect((await shown.arrayBuffer()).byteLength).toBeGreaterThan(0);

    const invalid = new FormData();
    invalid.append("photo", new File(["nope"], "notes.txt", { type: "text/plain" }));
    const rejected = await fetch(api("/users/me/photo"), {
      method: "POST",
      headers: { authorization: `Bearer ${registered.token}` },
      body: invalid,
    });
    expect(rejected.status).toBe(400);

    const deleted = await fetch(api("/users/me/photo"), {
      method: "DELETE",
      headers: { authorization: `Bearer ${registered.token}` },
    });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ photo_url: null });

    const missing = await fetch(api("/users/me/photo"), {
      headers: { authorization: `Bearer ${registered.token}` },
    });
    expect(missing.status).toBe(404);
  });

  test("PATCH and DELETE /users/me return 401 without credentials", async () => {
    const patch = await fetch(api("/users/me"), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Nope", email: "nope@workhub.test" }),
    });
    expect(patch.status).toBe(401);

    const response = await fetch(api("/users/me"), {
      method: "DELETE",
    });

    expect(response.status).toBe(401);
  });

  test("GET /users/me/export returns GDPR-style user export", async () => {
    const response = await fetch(api("/users/me/export"), {
      headers: adminHeaders(),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      user: { email: string };
      exported_at: string;
    };
    expect(body.user.email).toBe("admin@workhub.test");
    expect(body.exported_at).toBeTruthy();
  });

  test("responses include tracing and tenant headers", async () => {
    const response = await fetch(api("/organizations"), {
      headers: { "x-tenant-id": "1" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("x-trace-id")).toBeTruthy();
    expect(response.headers.get("x-tenant-id")).toBe("1");
    expect(response.headers.get("server-timing")).toContain("app");
  });

  test("SCIM endpoints require bearer token and list seeded users", async () => {
    const unauthorized = await fetch(`${baseUrl}/scim/v2/Users`);
    expect(unauthorized.status).toBe(401);

    const response = await fetch(`${baseUrl}/scim/v2/Users?count=10`, {
      headers: {
        authorization: `Bearer ${TEST_SCIM_BEARER_TOKEN}`,
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/scim+json");
    const body = (await response.json()) as {
      totalResults: number;
      Resources: Array<{ userName: string }>;
    };
    expect(body.totalResults).toBeGreaterThanOrEqual(2);
    expect(body.Resources.some((user) => user.userName === "admin@workhub.test")).toBe(true);
  });

  test("SCIM user GET returns ETag and PATCH requires If-Match", async () => {
    const scimHeaders = {
      authorization: `Bearer ${TEST_SCIM_BEARER_TOKEN}`,
    };

    const configResponse = await fetch(`${baseUrl}/scim/v2/ServiceProviderConfig`, {
      headers: scimHeaders,
    });
    expect(configResponse.status).toBe(200);
    const config = (await configResponse.json()) as { etag?: { supported?: boolean } };
    expect(config.etag?.supported).toBe(true);

    const showResponse = await fetch(`${baseUrl}/scim/v2/Users/1`, {
      headers: scimHeaders,
    });
    expect(showResponse.status).toBe(200);
    const etag = showResponse.headers.get("etag");
    expect(etag).toBeTruthy();

    const conditionalResponse = await fetch(`${baseUrl}/scim/v2/Users/1`, {
      headers: {
        ...scimHeaders,
        "if-none-match": etag ?? "",
      },
    });
    expect(conditionalResponse.status).toBe(304);

    const patchWithoutMatch = await fetch(`${baseUrl}/scim/v2/Users/1`, {
      method: "PATCH",
      headers: {
        ...scimHeaders,
        "content-type": "application/scim+json",
      },
      body: JSON.stringify({
        Operations: [{ op: "replace", path: "displayName", value: "Admin User" }],
      }),
    });
    expect(patchWithoutMatch.status).toBe(412);
  });

  test("DELETE /users/me anonymizes account and revokes tokens", async () => {
    const loginResponse = await fetch(api("/auth/login"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.77",
      },
      body: JSON.stringify({
        email: "member@workhub.test",
        password: "password",
      }),
    });

    expect(loginResponse.status).toBe(201);
    const loginBody = (await loginResponse.json()) as {
      token: string;
      user: { id: number; email: string };
    };
    expect(loginBody.user.email).toBe("member@workhub.test");

    const meResponse = await fetch(api("/auth/me"), {
      headers: { authorization: `Bearer ${loginBody.token}` },
    });
    expect(meResponse.status).toBe(200);

    const deleteResponse = await fetch(api("/users/me"), {
      method: "DELETE",
      headers: { authorization: `Bearer ${loginBody.token}` },
    });
    expect(deleteResponse.status).toBe(204);

    const revokedMeResponse = await fetch(api("/auth/me"), {
      headers: { authorization: `Bearer ${loginBody.token}` },
    });
    expect(revokedMeResponse.status).toBe(401);

    const seededMemberResponse = await fetch(api("/auth/me"), {
      headers: { authorization: `Bearer ${TEST_MEMBER_API_TOKEN}` },
    });
    expect(seededMemberResponse.status).toBe(401);

    const reloginResponse = await fetch(api("/auth/login"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "member@workhub.test",
        password: "password",
      }),
    });
    expect(reloginResponse.status).toBe(401);

    const adminResponse = await fetch(api("/auth/me"), {
      headers: { authorization: `Bearer ${TEST_ADMIN_API_TOKEN}` },
    });
    expect(adminResponse.status).toBe(200);
  });
});

const DISABLED_FEATURE_FLAGS = {
  FEATURE_AUDIT_LOG: "false",
  FEATURE_WEBHOOKS: "false",
  FEATURE_SEARCH: "false",
  FEATURE_SCIM: "false",
  FEATURE_BILLING: "false",
} as const;

describe("feature flags disable optional routes", () => {
  let disabledServer: ReturnType<typeof Bun.serve>;
  let disabledBaseUrl: string;
  const previousFlagValues: Partial<
    Record<keyof typeof DISABLED_FEATURE_FLAGS, string | undefined>
  > = {};

  function disabledApi(pathname: string): string {
    return `${disabledBaseUrl}/api/v1${pathname}`;
  }

  beforeAll(async () => {
    pinWorkhubIntegrationEnv();
    for (const [key, value] of Object.entries(DISABLED_FEATURE_FLAGS)) {
      const flag = key as keyof typeof DISABLED_FEATURE_FLAGS;
      previousFlagValues[flag] = process.env[flag];
      process.env[flag] = value;
    }

    const { createAppDependencies } = await import("../../src/bootstrap/dependencies");
    const { createRoutes } = await import("../../src/bootstrap/createRoutes");

    disabledServer = Bun.serve({
      port: 0,
      routes: createRoutes(createAppDependencies()),
    });

    disabledBaseUrl = disabledServer.url.toString().replace(/\/$/, "");
  });

  afterAll(() => {
    disabledServer.stop(true);

    for (const flag of Object.keys(DISABLED_FEATURE_FLAGS)) {
      const key = flag as keyof typeof DISABLED_FEATURE_FLAGS;
      const previous = previousFlagValues[key];

      if (previous === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous;
      }
    }
  });

  test("GET /search returns 404 when FEATURE_SEARCH=false", async () => {
    const response = await fetch(`${disabledApi("/search")}?q=registry`);
    expect(response.status).toBe(404);
  });

  test("GET /audit-logs returns 404 when FEATURE_AUDIT_LOG=false", async () => {
    const response = await fetch(disabledApi("/audit-logs"), {
      headers: { authorization: `Bearer ${TEST_ADMIN_API_TOKEN}` },
    });
    expect(response.status).toBe(404);
  });

  test("GET /webhooks returns 404 when FEATURE_WEBHOOKS=false", async () => {
    const response = await fetch(disabledApi("/webhooks"), {
      headers: { authorization: `Bearer ${TEST_ADMIN_API_TOKEN}` },
    });
    expect(response.status).toBe(404);
  });

  test("GET /billing/subscription returns 404 when FEATURE_BILLING=false", async () => {
    const response = await fetch(disabledApi("/billing/subscription"), {
      headers: { authorization: `Bearer ${TEST_ADMIN_API_TOKEN}` },
    });
    expect(response.status).toBe(404);
  });

  test("GET /scim/v2/Users returns 404 when FEATURE_SCIM=false", async () => {
    const response = await fetch(`${disabledBaseUrl}/scim/v2/Users`, {
      headers: { authorization: `Bearer ${TEST_SCIM_BEARER_TOKEN}` },
    });
    expect(response.status).toBe(404);
  });
});
