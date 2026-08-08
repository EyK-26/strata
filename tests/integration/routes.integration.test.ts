import { afterAll, beforeAll, describe, expect, test } from "bun:test";

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

async function getJson<T>(pathname: string): Promise<{
  response: Response;
  body: T;
}> {
  const response = await fetch(`${baseUrl}${pathname}`);
  return {
    response,
    body: (await response.json()) as T,
  };
}

beforeAll(async () => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;

  const [{ freshDatabase }, { createAppDependencies }, { createRoutes }] =
    await Promise.all([
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

afterAll(() => {
  server.stop(true);
});

describe("integration routes with postgres", () => {
  test("GET /health returns ok", async () => {
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  test("GET /ready reports database and redis checks", async () => {
    const response = await fetch(`${baseUrl}/ready`);
    const body = (await response.json()) as {
      status: string;
      checks: Record<string, string>;
    };

    expect(body.checks.database).toBe("ok");
    expect(body.status).toBe("ready");
  });

  test("GET /organizations returns paginated seeded organizations", async () => {
    const { response, body } = await getJson<
      PaginatedBody<{ id: number; slug: string; name: string }>
    >("/organizations");

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

  test("GET /organizations supports page and per_page query params", async () => {
    const { response, body } = await getJson<
      PaginatedBody<{ id: number; slug: string }>
    >("/organizations?per_page=1&page=2");

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
    const { response, body } = await getJson<{ error: string }>(
      "/organizations?per_page=0",
    );

    expect(response.status).toBe(400);
    expect(body).toEqual({
      error: 'Invalid query parameter "per_page". Expected a positive integer.',
    });
  });

  test("GET /organizations/:id returns 404 for missing rows", async () => {
    const { response, body } = await getJson<{ error: string }>(
      "/organizations/9999",
    );

    expect(response.status).toBe(404);
    expect(body).toEqual({
      error: "Organization 9999 not found.",
    });
  });

  test("POST /organizations returns 422 for invalid payloads", async () => {
    const response = await fetch(`${baseUrl}/organizations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
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

    const response = await fetch(`${baseUrl}/organizations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
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
    const response = await fetch(`${baseUrl}/organizations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
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
    const response = await fetch(`${baseUrl}/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        organization_id: 9999,
        name: "Ghost Project",
      }),
    });

    expect(response.status).toBe(404);
  });

  test("GET /tasks returns paginated seeded tasks", async () => {
    const { response, body } = await getJson<
      PaginatedBody<{ title: string }>
    >("/tasks");

    expect(response.status).toBe(200);
    expect(body.data.length).toBeGreaterThanOrEqual(4);
    expect(body.data[0]).toMatchObject({
      title: "Design module registry",
    });
  });

  test("POST /tasks creates a task for an existing project", async () => {
    const response = await fetch(`${baseUrl}/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
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
    const { response, body } = await getJson<PaginatedBody<{ body: string }>>(
      "/tasks/1/comments",
    );

    expect(response.status).toBe(200);
    expect(body.data.length).toBeGreaterThanOrEqual(2);
    expect(body.data[0]?.body).toContain("Registry");
  });

  test("POST /tasks/:id/comments creates a nested comment", async () => {
    const response = await fetch(`${baseUrl}/tasks/2/comments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
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

  test("GET /reports/summary returns cross-module counts", async () => {
    const { response, body } = await getJson<{
      organization_count: number;
      task_count: number;
      projects_by_status: Record<string, number>;
    }>("/reports/summary");

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
    }>("/reports/organizations/1");

    expect(response.status).toBe(200);
    expect(body.organization.slug).toBe("acme-labs");
    expect(body.project_count).toBeGreaterThanOrEqual(2);
    expect(body.task_count).toBeGreaterThanOrEqual(2);
  });

  test("DELETE /organizations/:id soft deletes the record", async () => {
    const createResponse = await fetch(`${baseUrl}/organizations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Soft Delete Co",
        slug: "soft-delete-co",
      }),
    });

    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as { id: number };

    const deleteResponse = await fetch(
      `${baseUrl}/organizations/${created.id}`,
      { method: "DELETE" },
    );

    expect(deleteResponse.status).toBe(204);

    const showResponse = await fetch(
      `${baseUrl}/organizations/${created.id}`,
    );
    expect(showResponse.status).toBe(404);

    const { body } = await getJson<PaginatedBody<{ slug: string }>>(
      "/organizations",
    );
    expect(body.data.some((organization) => organization.slug === "soft-delete-co")).toBe(
      false,
    );
  });

  test("DELETE /organizations/:id enforces protected organization policy", async () => {
    const createResponse = await fetch(`${baseUrl}/organizations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Protected Org",
        slug: "protected-org",
      }),
    });

    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as { id: number };

    const guestDeleteResponse = await fetch(
      `${baseUrl}/organizations/${created.id}`,
      { method: "DELETE" },
    );

    expect(guestDeleteResponse.status).toBe(403);

    const adminDeleteResponse = await fetch(
      `${baseUrl}/organizations/${created.id}`,
      {
        method: "DELETE",
        headers: {
          "x-authenticated-user-id": "1",
          "x-authenticated-user-role": "admin",
        },
      },
    );

    expect(adminDeleteResponse.status).toBe(204);

    const showResponse = await fetch(
      `${baseUrl}/organizations/${created.id}`,
    );
    expect(showResponse.status).toBe(404);
  });

  test("DELETE /projects/:id returns 401 for unauthenticated requests", async () => {
    const response = await fetch(`${baseUrl}/projects/1`, {
      method: "DELETE",
    });

    expect(response.status).toBe(401);
  });

  test("GET /reports/summary excludes soft-deleted organizations", async () => {
    const before = await getJson<{ organization_count: number }>("/reports/summary");

    const createResponse = await fetch(`${baseUrl}/organizations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Report Exclusion Co",
        slug: "report-exclusion-co",
      }),
    });

    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as { id: number };

    const afterCreate = await getJson<{ organization_count: number }>(
      "/reports/summary",
    );
    expect(afterCreate.body.organization_count).toBe(
      before.body.organization_count + 1,
    );

    const deleteResponse = await fetch(
      `${baseUrl}/organizations/${created.id}`,
      { method: "DELETE" },
    );
    expect(deleteResponse.status).toBe(204);

    const afterDelete = await getJson<{ organization_count: number }>(
      "/reports/summary",
    );
    expect(afterDelete.body.organization_count).toBe(
      before.body.organization_count,
    );

    const orgReportResponse = await fetch(
      `${baseUrl}/reports/organizations/${created.id}`,
    );
    expect(orgReportResponse.status).toBe(404);
  });
});
