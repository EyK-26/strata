import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { pinWorkhubIntegrationEnv } from "../helpers/integrationEnv";
import { restoreEnvVar } from "../helpers/restoreEnv";

const TEST_DATABASE_URL = process.env.DATABASE_URL;

if (!TEST_DATABASE_URL) {
  throw new Error("DATABASE_URL must be set before running integration tests.");
}

let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;
let adminSessionCookie = "";
const previousFrontendMode = process.env.FRONTEND_MODE;
const previousLoginRateLimit = process.env.LOGIN_RATE_LIMIT_PER_WINDOW;

function readSetCookies(response: Response): string[] {
  if (typeof response.headers.getSetCookie === "function") {
    return response.headers.getSetCookie();
  }

  const header = response.headers.get("set-cookie");

  return header ? [header] : [];
}

function mergeCookieHeader(existing: string, response: Response): string {
  const jar = new Map<string, string>();

  for (const part of existing.split("; ").filter(Boolean)) {
    const [name, ...rest] = part.split("=");

    if (name) {
      jar.set(name, rest.join("="));
    }
  }

  for (const setCookie of readSetCookies(response)) {
    const pair = setCookie.split(";")[0];

    if (!pair) {
      continue;
    }

    const [name, ...rest] = pair.split("=");

    if (name) {
      jar.set(name, rest.join("="));
    }
  }

  return Array.from(jar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

async function loginAndGetCookie(email: string, password: string): Promise<string> {
  const loginPage = await fetch(`${baseUrl}/login`);
  const html = await loginPage.text();
  const csrfMatch = html.match(/name="csrf-token" content="([^"]+)"/);
  const csrfToken = csrfMatch?.[1] ?? "";
  const cookies = mergeCookieHeader("", loginPage);

  const response = await fetch(`${baseUrl}/login`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: cookies,
    },
    body: new URLSearchParams({
      email,
      password,
      redirect: "/organizations",
      _token: csrfToken,
    }),
  });

  return mergeCookieHeader(cookies, response);
}

async function fetchCsrfFromPath(
  path: string,
  cookie = "",
): Promise<{ token: string; cookies: string }> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: cookie ? { cookie } : undefined,
  });
  const html = await response.text();
  const csrfMatch = html.match(/name="csrf-token" content="([^"]+)"/);

  return {
    token: csrfMatch?.[1] ?? "",
    cookies: mergeCookieHeader(cookie, response),
  };
}

beforeAll(async () => {
  mock.restore();
  pinWorkhubIntegrationEnv();
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.QUEUE_DRIVER = "sync";
  process.env.FRONTEND_MODE = "server-htmx";
  process.env.LOGIN_RATE_LIMIT_PER_WINDOW = "100";

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
  adminSessionCookie = await loginAndGetCookie("admin@workhub.test", "password");
});

afterAll(() => {
  server.stop(true);

  if (previousFrontendMode === undefined) {
    delete process.env.FRONTEND_MODE;
  } else {
    restoreEnvVar("FRONTEND_MODE", previousFrontendMode);
  }

  if (previousLoginRateLimit === undefined) {
    delete process.env.LOGIN_RATE_LIMIT_PER_WINDOW;
  } else {
    restoreEnvVar("LOGIN_RATE_LIMIT_PER_WINDOW", previousLoginRateLimit);
  }
});

describe("web routes with server-htmx frontend", () => {
  test("GET / redirects to organizations", async () => {
    const response = await fetch(baseUrl, { redirect: "manual" });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/organizations");
  });

  test("GET /organizations returns HTML", async () => {
    const response = await fetch(`${baseUrl}/organizations`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");

    const csp = response.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("style-src 'self'");
    expect(csp).toContain("https://unpkg.com");
    expect(csp).toContain("frame-src https://www.youtube.com");
    expect(csp).toMatch(/'nonce-[^']+'/);
    expect(csp).not.toContain("'unsafe-inline'");

    const html = await response.text();
    expect(html).toContain("Acme Labs");
    expect(html).toContain("inlineStyleNonce");
    expect(html).not.toContain('includeIndicatorStyles":false');
    expect(html).toContain('href="/login"');
    expect(html).not.toContain('action="/logout"');
  });

  test("GET a missing public HTML route returns a styled 404", async () => {
    const response = await fetch(`${baseUrl}/forum/nope/nope`);

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("/assets/app.css");
    expect(html).toContain("Not Found");
    expect(html).toContain("site-header");
  });

  test("GET /organizations shows sign out for signed-in session", async () => {
    const response = await fetch(`${baseUrl}/organizations`, {
      headers: { cookie: adminSessionCookie },
    });

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("admin@workhub.test");
    expect(html).toContain('action="/logout"');
    expect(html).not.toContain('href="/login"');
  });

  test("GET /organizations with HX-Request returns table partial", async () => {
    const response = await fetch(`${baseUrl}/organizations`, {
      headers: { "HX-Request": "true" },
    });

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("<table");
    expect(html).not.toContain("<!doctype html>");
  });

  test("GET /organizations/:id returns organization detail HTML", async () => {
    const response = await fetch(`${baseUrl}/organizations/1`);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Acme Labs");
  });

  test("GET /assets/app.css serves static styles", async () => {
    const response = await fetch(`${baseUrl}/assets/app.css`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/css");
  });

  test("POST /login sets a session cookie and redirects", async () => {
    const csrf = await fetchCsrfFromPath("/login");

    const response = await fetch(`${baseUrl}/login`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: csrf.cookies,
      },
      body: new URLSearchParams({
        email: "member@workhub.test",
        password: "password",
        redirect: "/organizations",
        _token: csrf.token,
      }),
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("set-cookie")).toContain("workhub_session=");
    expect(response.headers.get("location")).toBe("/organizations");
  });

  test("POST /organizations re-renders HTML validation errors", async () => {
    const csrf = await fetchCsrfFromPath("/organizations", adminSessionCookie);

    const response = await fetch(`${baseUrl}/organizations`, {
      method: "POST",
      redirect: "manual",
      headers: {
        cookie: csrf.cookies,
        "content-type": "application/x-www-form-urlencoded",
        accept: "text/html",
      },
      body: new URLSearchParams({
        name: "",
        slug: "INVALID SLUG",
        _token: csrf.token,
      }),
    });

    expect(response.status).toBe(422);
    expect(await response.text()).toContain("name");
  });

  test("POST /organizations redirects with flash success message", async () => {
    const csrf = await fetchCsrfFromPath("/organizations", adminSessionCookie);
    const slug = `flash-org-${Date.now()}`;

    const createResponse = await fetch(`${baseUrl}/organizations`, {
      method: "POST",
      redirect: "manual",
      headers: {
        cookie: csrf.cookies,
        "content-type": "application/x-www-form-urlencoded",
        accept: "text/html",
      },
      body: new URLSearchParams({
        name: "Flash Test Org",
        slug,
        _token: csrf.token,
      }),
    });

    expect(createResponse.status).toBe(302);
    expect(createResponse.headers.get("location")).toBe("/organizations");

    const followResponse = await fetch(`${baseUrl}/organizations`, {
      headers: { cookie: mergeCookieHeader(csrf.cookies, createResponse) },
    });

    expect(followResponse.status).toBe(200);
    expect(await followResponse.text()).toContain("Organization created.");
  });

  test("GET /projects returns HTML project list", async () => {
    const response = await fetch(`${baseUrl}/projects`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain("Platform Rewrite");
  });

  test("GET /tasks returns HTML task list", async () => {
    const response = await fetch(`${baseUrl}/tasks`);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Tasks");
  });

  test("GET /admin returns dashboard for signed-in admin session", async () => {
    const response = await fetch(`${baseUrl}/admin`, {
      headers: { cookie: adminSessionCookie },
    });

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Admin dashboard");
    expect(html).toContain("Queue metrics");
    expect(html).toContain("HTTP metrics");
    expect(html).toContain("Failed jobs");
    expect(html).toContain("Audit log");
  });

  test("GET /admin/queue renders queue monitor", async () => {
    const response = await fetch(`${baseUrl}/admin/queue`, {
      headers: { cookie: adminSessionCookie },
    });

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Queue monitor");
    expect(html).toContain("Pending jobs");
  });

  test("GET /admin/resources renders resource browser", async () => {
    const response = await fetch(`${baseUrl}/admin/resources`, {
      headers: { cookie: adminSessionCookie },
    });

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Admin resources");
    expect(html).toContain("Users");
    expect(html).toContain("/admin/resources/users");
  });

  test("GET /admin/audit renders paginated audit log", async () => {
    const response = await fetch(`${baseUrl}/admin/audit`, {
      headers: { cookie: adminSessionCookie },
    });

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Audit log");
    expect(html).toContain("pagination");
  });

  test("GET /admin/audit supports HTMX pagination partial", async () => {
    const response = await fetch(`${baseUrl}/admin/audit?page=1`, {
      headers: {
        cookie: adminSessionCookie,
        "HX-Request": "true",
      },
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("data-table");
  });

  test("GET /tasks/:id shows attachment upload UI", async () => {
    const response = await fetch(`${baseUrl}/tasks/1`);

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('hx-post="/tasks/1/attachments"');
    expect(html).toContain('hx-post="/tasks/1/comments"');
    expect(html).toContain('type="file"');
  });

  test("POST /projects creates project and redirects with flash", async () => {
    const csrf = await fetchCsrfFromPath("/projects", adminSessionCookie);
    const slugSuffix = Date.now();

    const response = await fetch(`${baseUrl}/projects`, {
      method: "POST",
      redirect: "manual",
      headers: {
        cookie: csrf.cookies,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        organization_id: "1",
        name: `HTMX Project ${slugSuffix}`,
        status: "active",
        _token: csrf.token,
      }),
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/projects");
  });

  test("POST /tasks/:id/comments appends comment list partial", async () => {
    const csrf = await fetchCsrfFromPath("/tasks/1", adminSessionCookie);

    const response = await fetch(`${baseUrl}/tasks/1/comments`, {
      method: "POST",
      headers: {
        cookie: csrf.cookies,
        "content-type": "application/x-www-form-urlencoded",
        "HX-Request": "true",
      },
      body: new URLSearchParams({
        body: `Integration comment ${Date.now()}`,
        _token: csrf.token,
      }),
    });

    expect(response.status).toBe(201);
    expect(await response.text()).toContain("comment-item");
  });

  test("GET /admin returns 403 for member session", async () => {
    const memberCookie = await loginAndGetCookie("member@workhub.test", "password");
    const response = await fetch(`${baseUrl}/admin`, {
      headers: { cookie: memberCookie },
    });

    expect(response.status).toBe(403);
  });
});
