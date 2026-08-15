import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  test("DELETE /users/me returns 401 without credentials", async () => {
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
