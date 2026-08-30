import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { hashPassword } from "@getstrata/core/auth/password";
import { temporarySignedUrl } from "@getstrata/core/http/signedUrl";
import { generateTotp } from "@getstrata/core/security/totp";
import { runWithMigrationBypass } from "@getstrata/core/tenant/databaseTenantContext";
import { getDatabase } from "../../src/db/connection";
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

async function confirmPasswordAndGetCookie(
  sessionCookie: string,
  password = "password",
  redirect = "/account",
): Promise<string> {
  const csrf = await fetchCsrfFromPath(
    `/confirm-password?redirect=${encodeURIComponent(redirect)}`,
    sessionCookie,
  );
  const response = await fetch(`${baseUrl}/confirm-password`, {
    method: "POST",
    redirect: "manual",
    headers: {
      cookie: csrf.cookies,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      password,
      redirect,
      _token: csrf.token,
    }),
  });

  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe(redirect);

  return mergeCookieHeader(csrf.cookies, response);
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

  const [{ freshDatabase }, { createAppDependencies }, { createRoutes }, { ensureModulesLoaded }] =
    await Promise.all([
      import("../../src/db/migrations/runner"),
      import("../../src/bootstrap/dependencies"),
      import("../../src/bootstrap/createRoutes"),
      import("@getstrata/bootstrap/discoverModules"),
    ]);

  await ensureModulesLoaded();
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
    expect(response.headers.get("set-cookie")).toContain("Max-Age=604800");
    expect(response.headers.get("location")).toBe("/organizations");
  });

  test("POST /login with remember sets a 30-day session cookie", async () => {
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
        remember: "1",
        _token: csrf.token,
      }),
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("set-cookie")).toContain("workhub_session=");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=2592000");

    const account = await fetch(`${baseUrl}/account`, {
      headers: { cookie: mergeCookieHeader("", response) },
    });
    expect(account.status).toBe(200);
  });

  test("POST /login without an MFA code redirects to /two-factor-challenge", async () => {
    const previousMfa = process.env.FEATURE_MFA;
    const email = `mfa-challenge-${Date.now()}@workhub.test`;
    const passwordHash = await hashPassword("password");
    const inserted = (await getDatabase()`
      INSERT INTO users (name, email, email_lookup, role, tenant_id, password_hash, email_verified_at)
      VALUES (${"Mfa Challenge User"}, ${email}, ${email}, ${"member"}, 1, ${passwordHash}, NOW())
      RETURNING id
    `) as Array<{ id: number }>;
    const userId = inserted[0]?.id;
    expect(userId).toBeTruthy();

    const sessionCookie = await loginAndGetCookie(email, "password");
    const setupCsrf = await fetchCsrfFromPath("/account", sessionCookie);
    const setup = await fetch(`${baseUrl}/account/mfa`, {
      method: "POST",
      headers: {
        cookie: setupCsrf.cookies,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ _token: setupCsrf.token }),
    });
    const setupHtml = await setup.text();
    const secret = setupHtml.match(/class="mfa-secret">([^<]+)/)?.[1]?.trim();
    expect(secret).toBeTruthy();

    const confirmCsrf = await fetchCsrfFromPath("/account", sessionCookie);
    const confirmed = await fetch(`${baseUrl}/account/mfa/confirm`, {
      method: "POST",
      headers: {
        cookie: confirmCsrf.cookies,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        mfa_code: generateTotp(String(secret), Math.floor(Date.now() / 30_000)),
        _token: confirmCsrf.token,
      }),
    });
    expect(confirmed.status).toBe(200);

    const logoutCsrf = await fetchCsrfFromPath("/account", sessionCookie);
    await fetch(`${baseUrl}/logout`, {
      method: "POST",
      redirect: "manual",
      headers: {
        cookie: logoutCsrf.cookies,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ _token: logoutCsrf.token }),
    });

    process.env.FEATURE_MFA = "true";
    try {
      const blocked = await fetch(`${baseUrl}/two-factor-challenge`, { redirect: "manual" });
      expect(blocked.status).toBe(302);
      expect(blocked.headers.get("location")).toBe("/login");

      const loginCsrf = await fetchCsrfFromPath("/login");
      const challenged = await fetch(`${baseUrl}/login`, {
        method: "POST",
        redirect: "manual",
        headers: {
          cookie: loginCsrf.cookies,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          email,
          password: "password",
          redirect: "/reports",
          _token: loginCsrf.token,
        }),
      });
      expect(challenged.status).toBe(302);
      expect(challenged.headers.get("location")).toBe("/two-factor-challenge?redirect=%2Freports");
      expect(
        readSetCookies(challenged).some((cookie) => cookie.startsWith("workhub_mfa_pending=")),
      ).toBe(true);

      const pendingCookies = mergeCookieHeader(loginCsrf.cookies, challenged);
      const challengePage = await fetch(`${baseUrl}/two-factor-challenge?redirect=%2Freports`, {
        headers: { cookie: pendingCookies },
      });
      expect(challengePage.status).toBe(200);
      expect(await challengePage.text()).toContain("Two-factor authentication");

      const challengeCsrf = await fetchCsrfFromPath(
        "/two-factor-challenge?redirect=%2Freports",
        pendingCookies,
      );
      const completed = await fetch(`${baseUrl}/two-factor-challenge`, {
        method: "POST",
        redirect: "manual",
        headers: {
          cookie: challengeCsrf.cookies,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          mfa_code: generateTotp(String(secret), Math.floor(Date.now() / 30_000)),
          redirect: "/reports",
          _token: challengeCsrf.token,
        }),
      });
      expect(completed.status).toBe(302);
      expect(completed.headers.get("location")).toBe("/reports");
      expect(completed.headers.get("set-cookie")).toContain("workhub_session=");

      const reports = await fetch(`${baseUrl}/reports`, {
        headers: { cookie: mergeCookieHeader(pendingCookies, completed) },
      });
      expect(reports.status).toBe(200);
    } finally {
      restoreEnvVar("FEATURE_MFA", previousMfa);
    }
  });

  test("GET /login and /register redirect signed-in users home", async () => {
    const login = await fetch(`${baseUrl}/login`, {
      redirect: "manual",
      headers: { cookie: adminSessionCookie },
    });
    const register = await fetch(`${baseUrl}/register`, {
      redirect: "manual",
      headers: { cookie: adminSessionCookie },
    });

    expect(login.status).toBe(302);
    expect(login.headers.get("location")).toBe("/organizations");
    expect(register.status).toBe(302);
    expect(register.headers.get("location")).toBe("/organizations");
  });

  test("GET /register and POST /register create a session without an API token", async () => {
    const page = await fetch(`${baseUrl}/register`);
    expect(page.status).toBe(200);
    const pageHtml = await page.text();
    expect(pageHtml).toContain("Create account");
    expect(pageHtml).toContain('action="/register"');

    const loginPage = await fetch(`${baseUrl}/login`);
    expect(await loginPage.text()).toContain('href="/register"');

    const csrf = await fetchCsrfFromPath("/register");
    const email = `html-register-${Date.now()}@workhub.test`;
    const response = await fetch(`${baseUrl}/register`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: csrf.cookies,
      },
      body: new URLSearchParams({
        name: "HTML Register",
        email,
        password: "password123",
        password_confirmation: "password123",
        _token: csrf.token,
      }),
    });

    expect(response.status).toBe(302);
    const location = response.headers.get("location") ?? "";
    expect(location).toMatch(/^\/organizations\/\d+$/);
    expect(response.headers.get("set-cookie")).toContain("workhub_session=");

    const session = mergeCookieHeader("", response);
    const workspace = await fetch(`${baseUrl}${location}`, {
      headers: { cookie: session },
    });
    expect(workspace.status).toBe(200);
    const workspaceHtml = await workspace.text();
    expect(workspaceHtml).toContain("HTML Register&#39;s workspace");
    expect(workspaceHtml).toContain("personal-");

    const organizations = await fetch(`${baseUrl}/organizations`, {
      headers: { cookie: session },
    });
    expect(organizations.status).toBe(200);
    const organizationsHtml = await organizations.text();
    expect(organizationsHtml).toContain(email);
    expect(organizationsHtml).toContain("HTML Register&#39;s workspace");

    const duplicate = await fetch(`${baseUrl}/register`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: csrf.cookies,
        accept: "text/html",
      },
      body: new URLSearchParams({
        name: "HTML Register",
        email,
        password: "password123",
        password_confirmation: "password123",
        _token: csrf.token,
      }),
    });

    expect(duplicate.status).toBe(422);
    expect(await duplicate.text()).toContain("already exists");
  });

  test("GET /register?redirect= and POST /register honor a same-origin intended URL", async () => {
    const page = await fetch(`${baseUrl}/register?redirect=${encodeURIComponent("/account")}`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('name="redirect" value="/account"');

    const csrf = await fetchCsrfFromPath("/register?redirect=%2Faccount");
    const email = `html-register-redirect-${Date.now()}@workhub.test`;
    const response = await fetch(`${baseUrl}/register`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: csrf.cookies,
      },
      body: new URLSearchParams({
        name: "Redirect Register",
        email,
        password: "password123",
        password_confirmation: "password123",
        redirect: "/account",
        _token: csrf.token,
      }),
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/account");

    const session = mergeCookieHeader("", response);
    const account = await fetch(`${baseUrl}/account`, {
      headers: { cookie: session },
    });
    expect(account.status).toBe(200);
    expect(await account.text()).toContain("Redirect Register");
  });

  test("POST /register succeeds when an existing webhook URL is blocked", async () => {
    await runWithMigrationBypass(async () => {
      await getDatabase()`
        INSERT INTO webhook (organization_id, tenant_id, url, secret, events, active, created_at)
        VALUES (
          NULL,
          1,
          ${"http://127.0.0.1/html-hook"},
          ${"whsec_blocked_html_register"},
          ${["*"]},
          TRUE,
          NOW()
        )
      `;
    });

    const csrf = await fetchCsrfFromPath("/register");
    const email = `html-blocked-hook-${Date.now()}@workhub.test`;
    const response = await fetch(`${baseUrl}/register`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: csrf.cookies,
      },
      body: new URLSearchParams({
        name: "Blocked Hook Register",
        email,
        password: "password123",
        password_confirmation: "password123",
        _token: csrf.token,
      }),
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("location") ?? "").toMatch(/^\/organizations\/\d+$/);
    expect(response.headers.get("set-cookie")).toContain("workhub_session=");
  });

  test("POST /register with email verification starts a session on the verify notice", async () => {
    const previous = process.env.FEATURE_EMAIL_VERIFICATION;
    process.env.FEATURE_EMAIL_VERIFICATION = "true";
    const csrf = await fetchCsrfFromPath("/register");
    const email = `html-verify-${Date.now()}@workhub.test`;

    try {
      const response = await fetch(`${baseUrl}/register`, {
        method: "POST",
        redirect: "manual",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: csrf.cookies,
        },
        body: new URLSearchParams({
          name: "HTML Verify",
          email,
          password: "password123",
          password_confirmation: "password123",
          _token: csrf.token,
        }),
      });

      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("/email/verify");
      expect(response.headers.get("set-cookie")).toContain("workhub_session=");

      const session = mergeCookieHeader("", response);
      const notice = await fetch(`${baseUrl}/email/verify`, {
        headers: { cookie: session },
      });
      expect(notice.status).toBe(200);
      expect(await notice.text()).toContain("Verify your email");

      const account = await fetch(`${baseUrl}/account`, {
        redirect: "manual",
        headers: { cookie: session },
      });
      expect(account.status).toBe(302);
      expect(account.headers.get("location")).toBe("/email/verify");

      const login = await fetch(`${baseUrl}/login`, {
        redirect: "manual",
        headers: { cookie: session },
      });
      expect(login.status).toBe(302);
      expect(login.headers.get("location")).toBe("/email/verify");
    } finally {
      restoreEnvVar("FEATURE_EMAIL_VERIFICATION", previous);
    }
  });

  test("GET /login lists the mock OAuth provider", async () => {
    const response = await fetch(`${baseUrl}/login`);

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Sign in with Mock provider");
    expect(html).toContain('href="/oauth/mock?redirect=');
  });

  test("GET /oauth/mock/callback sets a session cookie without an API token", async () => {
    const start = await fetch(`${baseUrl}/oauth/mock?redirect=/organizations`, {
      redirect: "manual",
    });

    expect(start.status).toBe(302);
    const location = start.headers.get("location") ?? "";
    expect(location).toContain("/oauth/mock/callback");
    expect(location).toContain("code=valid-code");
    const state = new URL(location, baseUrl).searchParams.get("state");
    expect(state).toBeTruthy();

    const callback = await fetch(`${baseUrl}/oauth/mock/callback?code=valid-code&state=${state}`, {
      redirect: "manual",
      headers: { cookie: mergeCookieHeader("", start) },
    });

    expect(callback.status).toBe(302);
    const workspaceLocation = callback.headers.get("location") ?? "";
    expect(workspaceLocation).toMatch(/^\/organizations\/\d+$/);
    expect(callback.headers.get("set-cookie")).toContain("workhub_session=");

    const session = mergeCookieHeader("", callback);
    const workspace = await fetch(`${baseUrl}${workspaceLocation}`, {
      headers: { cookie: session },
    });
    expect(workspace.status).toBe(200);
    const workspaceHtml = await workspace.text();
    expect(workspaceHtml).toContain("OAuth User&#39;s workspace");
    expect(workspaceHtml).toContain("oauth@workhub.test");

    const organizations = await fetch(`${baseUrl}/organizations`, {
      headers: { cookie: session },
    });

    expect(organizations.status).toBe(200);
    const html = await organizations.text();
    expect(html).toContain("oauth@workhub.test");
    expect(html).toContain("OAuth User&#39;s workspace");
    expect(html).toContain('action="/logout"');
  });

  test("GET /oauth/mock/callback rejects an invalid state", async () => {
    const response = await fetch(`${baseUrl}/oauth/mock/callback?code=valid-code&state=nope`, {
      headers: { accept: "text/html" },
    });

    expect(response.status).toBe(422);
    expect(await response.text()).toContain("Invalid OAuth state.");
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

  test("POST without CSRF is rejected", async () => {
    const response = await fetch(`${baseUrl}/organizations`, {
      method: "POST",
      redirect: "manual",
      headers: {
        cookie: adminSessionCookie,
        "content-type": "application/x-www-form-urlencoded",
        accept: "text/html",
      },
      body: new URLSearchParams({
        name: "No CSRF",
        slug: "no-csrf",
      }),
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });

  test("GET /search returns HTMX results for signed-in users", async () => {
    const response = await fetch(`${baseUrl}/search?q=platform`, {
      headers: {
        cookie: adminSessionCookie,
        "HX-Request": "true",
      },
    });

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).not.toContain("<!doctype html>");
    expect(
      html.includes("search-results") || html.includes("No matches") || html.includes("task"),
    ).toBe(true);
  });

  test("GET /search finds organizations by slug", async () => {
    const response = await fetch(`${baseUrl}/search?q=acme-labs`, {
      headers: {
        cookie: adminSessionCookie,
        "HX-Request": "true",
      },
    });

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Acme Labs");
  });

  test("GET /notifications renders the inbox partial", async () => {
    const response = await fetch(`${baseUrl}/notifications`, {
      headers: { cookie: adminSessionCookie },
    });

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("notifications-inbox");
    expect(html).toContain("Welcome to WorkHub");
  });

  test("POST /notifications/read-all marks the inbox read", async () => {
    const csrf = await fetchCsrfFromPath("/organizations", adminSessionCookie);
    const response = await fetch(`${baseUrl}/notifications/read-all`, {
      method: "POST",
      headers: {
        cookie: csrf.cookies,
        "content-type": "application/x-www-form-urlencoded",
        "HX-Request": "true",
      },
      body: new URLSearchParams({ _token: csrf.token }),
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("notifications-inbox");
  });

  test("GET /billing and /webhooks are available to an admin session", async () => {
    const billing = await fetch(`${baseUrl}/billing`, {
      headers: { cookie: adminSessionCookie },
    });
    const webhooks = await fetch(`${baseUrl}/webhooks`, {
      headers: { cookie: adminSessionCookie },
    });

    expect(billing.status).toBe(200);
    expect(await billing.text()).toContain("Billing");
    expect(webhooks.status).toBe(200);
    const webhookHtml = await webhooks.text();
    expect(webhookHtml).toContain("Outbound webhooks");
    expect(webhookHtml).toContain("x-workhub-signature");
  });

  test("admin can deactivate, retry, and delete a webhook from HTML", async () => {
    const csrf = await fetchCsrfFromPath("/webhooks", adminSessionCookie);
    const url = `https://hooks.example.com/html-${Date.now()}`;
    const createResponse = await fetch(`${baseUrl}/webhooks`, {
      method: "POST",
      redirect: "manual",
      headers: {
        cookie: csrf.cookies,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        url,
        secret: "html-secret",
        events: "task.created",
        _token: csrf.token,
      }),
    });

    expect(createResponse.status).toBe(302);

    const created = await runWithMigrationBypass(
      async () =>
        (await getDatabase()`
          SELECT id FROM webhook WHERE url = ${url} ORDER BY id DESC LIMIT 1
        `) as Array<{ id: number }>,
    );
    const webhookId = created[0]?.id;
    expect(webhookId).toBeTruthy();

    const deactivateCsrf = await fetchCsrfFromPath("/webhooks", adminSessionCookie);
    const deactivated = await fetch(`${baseUrl}/webhooks/${webhookId}/deactivate`, {
      method: "POST",
      redirect: "manual",
      headers: {
        cookie: deactivateCsrf.cookies,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ _token: deactivateCsrf.token }),
    });
    expect(deactivated.status).toBe(302);

    const afterDeactivate = await fetch(`${baseUrl}/webhooks`, {
      headers: { cookie: adminSessionCookie },
    });
    expect(await afterDeactivate.text()).toContain(`/webhooks/${webhookId}/activate`);

    const activateCsrf = await fetchCsrfFromPath("/webhooks", adminSessionCookie);
    const activated = await fetch(`${baseUrl}/webhooks/${webhookId}/activate`, {
      method: "POST",
      redirect: "manual",
      headers: {
        cookie: activateCsrf.cookies,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ _token: activateCsrf.token }),
    });
    expect(activated.status).toBe(302);

    const delivery = (await getDatabase()`
      INSERT INTO webhook_delivery (webhook_id, event, payload, response_status)
      VALUES (${webhookId}, ${"task.created"}, ${{ id: 7 }}, 500)
      RETURNING id
    `) as Array<{ id: number }>;
    const deliveryId = delivery[0]?.id;
    expect(deliveryId).toBeTruthy();

    const withDelivery = await fetch(`${baseUrl}/webhooks`, {
      headers: { cookie: adminSessionCookie },
    });
    expect(await withDelivery.text()).toContain(`/webhooks/deliveries/${deliveryId}/retry`);

    const deleteCsrf = await fetchCsrfFromPath("/webhooks", adminSessionCookie);
    const deleted = await fetch(`${baseUrl}/webhooks/${webhookId}/delete`, {
      method: "POST",
      redirect: "manual",
      headers: {
        cookie: deleteCsrf.cookies,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ _token: deleteCsrf.token }),
    });
    expect(deleted.status).toBe(302);

    const remaining = await runWithMigrationBypass(
      async () =>
        (await getDatabase()`
          SELECT id FROM webhook WHERE id = ${webhookId}
        `) as Array<{ id: number }>,
    );
    expect(remaining).toEqual([]);
  });

  test("GET /reset-password requires a valid signed URL", async () => {
    const unsigned = await fetch(`${baseUrl}/reset-password`);
    expect(unsigned.status).toBe(403);

    const path = temporarySignedUrl("/reset-password", 120, {
      email: "admin@workhub.test",
      token: "demo-token",
    });
    const signed = await fetch(`${baseUrl}${path}`);
    expect(signed.status).toBe(200);
    expect(await signed.text()).toContain("Choose a new password");
  });

  test("GET /forgot-password renders the reset form", async () => {
    const response = await fetch(`${baseUrl}/forgot-password`);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Forgot password");
  });

  test("POST /forgot-password does not leak whether the email exists", async () => {
    const csrf = await fetchCsrfFromPath("/forgot-password");
    const response = await fetch(`${baseUrl}/forgot-password`, {
      method: "POST",
      headers: {
        cookie: csrf.cookies,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        email: "missing@workhub.test",
        _token: csrf.token,
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("If an account exists");
  });

  test("GET /organizations/:id includes member management", async () => {
    const response = await fetch(`${baseUrl}/organizations/1`, {
      headers: { cookie: adminSessionCookie },
    });

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("org-members");
    expect(html).toContain("admin@workhub.test");
    expect(html).toContain("Update role");
    expect(html).toContain('hx-post="/organizations/1/members/2/role"');
    expect(html).toContain("Add or invite");
  });

  test("POST /organizations/:id/members adds a registered user to the HTMX members table", async () => {
    const registerCsrf = await fetchCsrfFromPath("/register");
    const email = `html-member-${Date.now()}@workhub.test`;
    const registered = await fetch(`${baseUrl}/register`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: registerCsrf.cookies,
      },
      body: new URLSearchParams({
        name: "HTML Member",
        email,
        password: "password123",
        password_confirmation: "password123",
        _token: registerCsrf.token,
      }),
    });

    expect(registered.status).toBe(302);

    const csrf = await fetchCsrfFromPath("/organizations/1", adminSessionCookie);
    const response = await fetch(`${baseUrl}/organizations/1/members`, {
      method: "POST",
      headers: {
        cookie: csrf.cookies,
        "content-type": "application/x-www-form-urlencoded",
        accept: "text/html",
        "HX-Request": "true",
      },
      body: new URLSearchParams({
        email,
        role: "member",
        _token: csrf.token,
      }),
    });

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("org-members");
    expect(html).toContain(email);
    expect(html).toContain("HTML Member");
    expect(html).not.toContain("<!doctype html>");

    const inviteEmail = `html-invite-${Date.now()}@workhub.test`;
    const invited = await fetch(`${baseUrl}/organizations/1/members`, {
      method: "POST",
      headers: {
        cookie: csrf.cookies,
        "content-type": "application/x-www-form-urlencoded",
        accept: "text/html",
        "HX-Request": "true",
      },
      body: new URLSearchParams({
        email: inviteEmail,
        role: "member",
        _token: csrf.token,
      }),
    });

    expect(invited.status).toBe(200);
    const invitedHtml = await invited.text();
    expect(invitedHtml).toContain("Pending invitations");
    expect(invitedHtml).toContain(inviteEmail);
    expect(invitedHtml).toContain("Add or invite");
  });

  test("registering an invited email auto-joins the organization", async () => {
    const csrf = await fetchCsrfFromPath("/organizations/1", adminSessionCookie);
    const email = `auto-join-${Date.now()}@workhub.test`;
    const invited = await fetch(`${baseUrl}/organizations/1/members`, {
      method: "POST",
      headers: {
        cookie: csrf.cookies,
        "content-type": "application/x-www-form-urlencoded",
        accept: "text/html",
      },
      body: new URLSearchParams({
        email,
        role: "member",
        _token: csrf.token,
      }),
      redirect: "manual",
    });
    expect(invited.status).toBe(302);

    const registerCsrf = await fetchCsrfFromPath("/register");
    const registered = await fetch(`${baseUrl}/register`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: registerCsrf.cookies,
      },
      body: new URLSearchParams({
        name: "Auto Join",
        email,
        password: "password123",
        password_confirmation: "password123",
        _token: registerCsrf.token,
      }),
    });
    expect(registered.status).toBe(302);

    const show = await fetch(`${baseUrl}/organizations/1`, {
      headers: { cookie: adminSessionCookie, accept: "text/html" },
    });
    const html = await show.text();
    expect(html).toContain("Auto Join");
    expect(html).toContain(`Role for ${email}`);
  });

  test("POST /organizations/:id/members/:userId/role updates the HTMX members table", async () => {
    const csrf = await fetchCsrfFromPath("/organizations/1", adminSessionCookie);
    const response = await fetch(`${baseUrl}/organizations/1/members/2/role`, {
      method: "POST",
      headers: {
        cookie: csrf.cookies,
        "content-type": "application/x-www-form-urlencoded",
        accept: "text/html",
        "HX-Request": "true",
      },
      body: new URLSearchParams({
        role: "member",
        _token: csrf.token,
      }),
    });

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("org-members");
    expect(html).toContain("member@workhub.test");
    expect(html).toContain('value="member" selected');
    expect(html).not.toContain("<!doctype html>");

    const restore = await fetch(`${baseUrl}/organizations/1/members/2/role`, {
      method: "POST",
      headers: {
        cookie: csrf.cookies,
        "content-type": "application/x-www-form-urlencoded",
        accept: "text/html",
        "HX-Request": "true",
      },
      body: new URLSearchParams({
        role: "admin",
        _token: csrf.token,
      }),
    });

    expect(restore.status).toBe(200);
    expect(await restore.text()).toContain('value="admin" selected');
  });

  test("POST /organizations/:id/members/:userId/role rejects an invalid role", async () => {
    const csrf = await fetchCsrfFromPath("/organizations/1", adminSessionCookie);
    const response = await fetch(`${baseUrl}/organizations/1/members/2/role`, {
      method: "POST",
      headers: {
        cookie: csrf.cookies,
        "content-type": "application/x-www-form-urlencoded",
        accept: "text/html",
        "HX-Request": "true",
      },
      body: new URLSearchParams({
        role: "superadmin",
        _token: csrf.token,
      }),
    });

    expect(response.status).toBe(422);
    expect(await response.text()).toContain("Invalid organization role.");
  });

  test("GET /reports and /account are available to a signed-in session", async () => {
    const reports = await fetch(`${baseUrl}/reports`, {
      headers: { cookie: adminSessionCookie },
    });
    const account = await fetch(`${baseUrl}/account`, {
      headers: { cookie: adminSessionCookie },
    });
    const orgReport = await fetch(`${baseUrl}/reports/organizations/1`, {
      headers: { cookie: adminSessionCookie },
    });

    expect(reports.status).toBe(200);
    expect(await reports.text()).toContain("Reports");
    expect(account.status).toBe(200);
    const accountHtml = await account.text();
    expect(accountHtml).toContain("admin@workhub.test");
    expect(accountHtml).toContain("Update profile");
    expect(accountHtml).toContain("Two-factor authentication");
    expect(accountHtml).toContain("API tokens");
    expect(accountHtml).toContain("Export my data");
    expect(accountHtml).toContain("Profile photo");
    expect(accountHtml).toContain("Upload photo");
    expect(accountHtml).toContain("No profile photo yet.");
    expect(orgReport.status).toBe(200);
    expect(await orgReport.text()).toContain("Acme Labs");
  });

  test("POST /account/photo uploads and POST /account/photo/delete removes a photo", async () => {
    const email = `photo-html-${Date.now()}@workhub.test`;
    const passwordHash = await hashPassword("password");
    const inserted = (await getDatabase()`
      INSERT INTO users (name, email, email_lookup, role, tenant_id, password_hash, email_verified_at)
      VALUES (${"Photo Html User"}, ${email}, ${email}, ${"member"}, 1, ${passwordHash}, NOW())
      RETURNING id
    `) as Array<{ id: number }>;
    expect(inserted[0]?.id).toBeTruthy();

    const sessionCookie = await loginAndGetCookie(email, "password");
    const csrf = await fetchCsrfFromPath("/account", sessionCookie);
    const png = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      ),
      (char) => char.charCodeAt(0),
    );
    const formData = new FormData();
    formData.append("_token", csrf.token);
    formData.append("photo", new File([png], "avatar.png", { type: "image/png" }));

    const uploaded = await fetch(`${baseUrl}/account/photo`, {
      method: "POST",
      redirect: "manual",
      headers: { cookie: csrf.cookies },
      body: formData,
    });
    expect(uploaded.status).toBe(302);
    expect(uploaded.headers.get("location")).toBe("/account");

    const account = await fetch(`${baseUrl}/account`, {
      headers: { cookie: sessionCookie },
    });
    const html = await account.text();
    expect(account.status).toBe(200);
    expect(html).toContain("Remove photo");
    expect(html).toContain('src="/account/photo"');

    const image = await fetch(`${baseUrl}/account/photo`, {
      headers: { cookie: sessionCookie },
    });
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/png");
    expect((await image.arrayBuffer()).byteLength).toBeGreaterThan(0);

    const deleteCsrf = await fetchCsrfFromPath("/account", sessionCookie);
    const deleted = await fetch(`${baseUrl}/account/photo/delete`, {
      method: "POST",
      redirect: "manual",
      headers: {
        cookie: deleteCsrf.cookies,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ _token: deleteCsrf.token }),
    });
    expect(deleted.status).toBe(302);
    expect(deleted.headers.get("location")).toBe("/account");

    const after = await fetch(`${baseUrl}/account`, {
      headers: { cookie: sessionCookie },
    });
    expect(await after.text()).toContain("No profile photo yet.");
  });

  test("POST /account/profile updates a disposable user name without touching admin", async () => {
    const email = `profile-html-${Date.now()}@workhub.test`;
    const passwordHash = await hashPassword("password");
    const inserted = (await getDatabase()`
      INSERT INTO users (name, email, email_lookup, role, tenant_id, password_hash, email_verified_at)
      VALUES (${"Profile Html User"}, ${email}, ${email}, ${"member"}, 1, ${passwordHash}, NOW())
      RETURNING id
    `) as Array<{ id: number }>;
    const userId = inserted[0]?.id;
    expect(userId).toBeTruthy();

    const sessionCookie = await loginAndGetCookie(email, "password");
    const csrf = await fetchCsrfFromPath("/account", sessionCookie);
    const updated = await fetch(`${baseUrl}/account/profile`, {
      method: "POST",
      redirect: "manual",
      headers: {
        cookie: csrf.cookies,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        name: "Renamed Profile User",
        email,
        _token: csrf.token,
      }),
    });

    expect(updated.status).toBe(302);
    expect(updated.headers.get("location")).toBe("/account");

    const account = await fetch(`${baseUrl}/account`, {
      headers: { cookie: sessionCookie },
    });
    const html = await account.text();
    expect(account.status).toBe(200);
    expect(html).toContain("Renamed Profile User");
    expect(html).toContain(email);

    const takenCsrf = await fetchCsrfFromPath("/account", sessionCookie);
    const taken = await fetch(`${baseUrl}/account/profile`, {
      method: "POST",
      headers: {
        cookie: takenCsrf.cookies,
        "content-type": "application/x-www-form-urlencoded",
        accept: "text/html",
      },
      body: new URLSearchParams({
        name: "Renamed Profile User",
        email: "admin@workhub.test",
        _token: takenCsrf.token,
      }),
    });
    expect(taken.status).toBe(422);
    expect(await taken.text()).toContain("An account with this email already exists.");

    const admin = (await getDatabase()`
      SELECT name, email FROM users WHERE id = 1
    `) as Array<{ name: string; email: string }>;
    expect(admin[0]?.email).toBe("admin@workhub.test");
  });

  test("POST /account/password rejects a wrong current password", async () => {
    const csrf = await fetchCsrfFromPath("/account", adminSessionCookie);
    const response = await fetch(`${baseUrl}/account/password`, {
      method: "POST",
      headers: {
        cookie: csrf.cookies,
        "content-type": "application/x-www-form-urlencoded",
        accept: "text/html",
      },
      body: new URLSearchParams({
        current_password: "not-the-password",
        password: "brand-new-pass",
        _token: csrf.token,
      }),
    });

    expect(response.status).toBe(422);
    expect(await response.text()).toContain("Invalid credentials.");
  });

  test("POST /account/logout-other-devices revokes API tokens for a disposable user", async () => {
    const registerCsrf = await fetchCsrfFromPath("/register");
    const email = `html-logout-other-${Date.now()}@workhub.test`;
    const registered = await fetch(`${baseUrl}/register`, {
      method: "POST",
      redirect: "manual",
      headers: {
        cookie: registerCsrf.cookies,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        name: "Logout Other",
        email,
        password: "password123",
        password_confirmation: "password123",
        _token: registerCsrf.token,
      }),
    });
    expect(registered.status).toBe(302);
    const sessionA = mergeCookieHeader("", registered);
    const sessionB = await loginAndGetCookie(email, "password123");
    const session = sessionB;

    const tokenCsrf = await fetchCsrfFromPath("/account", session);
    const tokenName = `logout-other-${Date.now()}`;
    const created = await fetch(`${baseUrl}/account/tokens`, {
      method: "POST",
      headers: {
        cookie: tokenCsrf.cookies,
        "content-type": "application/x-www-form-urlencoded",
        accept: "text/html",
      },
      body: new URLSearchParams({
        name: tokenName,
        _token: tokenCsrf.token,
      }),
    });
    expect(created.status).toBe(200);
    expect(await created.text()).toContain(tokenName);

    const logoutCsrf = await fetchCsrfFromPath("/account", session);
    expect(
      await (await fetch(`${baseUrl}/account`, { headers: { cookie: session } })).text(),
    ).toContain("logout-other-devices");
    const loggedOut = await fetch(`${baseUrl}/account/logout-other-devices`, {
      method: "POST",
      redirect: "manual",
      headers: {
        cookie: logoutCsrf.cookies,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        password: "password123",
        _token: logoutCsrf.token,
      }),
    });
    expect(loggedOut.status).toBe(302);
    expect(loggedOut.headers.get("location")).toBe("/account");

    const after = await fetch(`${baseUrl}/account`, {
      headers: { cookie: mergeCookieHeader(session, loggedOut) },
    });
    expect(after.status).toBe(200);
    expect(await after.text()).not.toContain(tokenName);

    const stale = await fetch(`${baseUrl}/account`, {
      redirect: "manual",
      headers: { cookie: sessionA },
    });
    expect(stale.status).toBe(302);
    expect(stale.headers.get("location") ?? "").toContain("/login");
  });

  test("POST /account/tokens creates a token and POST revoke removes it", async () => {
    const csrf = await fetchCsrfFromPath("/account", adminSessionCookie);
    const name = `html-token-${Date.now()}`;
    const createResponse = await fetch(`${baseUrl}/account/tokens`, {
      method: "POST",
      headers: {
        cookie: csrf.cookies,
        "content-type": "application/x-www-form-urlencoded",
        accept: "text/html",
      },
      body: new URLSearchParams({
        name,
        expires_in_days: "30",
        _token: csrf.token,
      }),
    });

    expect(createResponse.status).toBe(200);
    const createdHtml = await createResponse.text();
    expect(createdHtml).toContain("plain-token");
    expect(createdHtml).toContain(name);

    const createdRows = (await getDatabase()`
      SELECT id FROM api_token WHERE name = ${name} ORDER BY id DESC LIMIT 1
    `) as Array<{ id: number }>;
    const tokenId = createdRows[0]?.id;
    expect(tokenId).toBeTruthy();

    const revokeCsrf = await fetchCsrfFromPath("/account", adminSessionCookie);
    const revokeResponse = await fetch(`${baseUrl}/account/tokens/${tokenId}/revoke`, {
      method: "POST",
      redirect: "manual",
      headers: {
        cookie: revokeCsrf.cookies,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ _token: revokeCsrf.token }),
    });

    expect(revokeResponse.status).toBe(302);
    expect(revokeResponse.headers.get("location")).toBe("/account");

    const after = await fetch(`${baseUrl}/account`, {
      headers: { cookie: adminSessionCookie },
    });
    expect(await after.text()).not.toContain(name);
  });

  test("GET /account/export downloads a GDPR JSON attachment", async () => {
    const blocked = await fetch(`${baseUrl}/account/export`, {
      redirect: "manual",
      headers: { cookie: adminSessionCookie },
    });
    expect(blocked.status).toBe(302);
    expect(blocked.headers.get("location")).toBe("/confirm-password?redirect=%2Faccount%2Fexport");

    const confirmPage = await fetch(`${baseUrl}${blocked.headers.get("location")}`, {
      headers: { cookie: adminSessionCookie },
    });
    expect(confirmPage.status).toBe(200);
    expect(await confirmPage.text()).toContain("Confirm your password");

    const confirmedCookie = await confirmPasswordAndGetCookie(
      adminSessionCookie,
      "password",
      "/account/export",
    );
    const response = await fetch(`${baseUrl}/account/export`, {
      headers: { cookie: confirmedCookie },
    });
    const payload = (await response.json()) as {
      user: { email: string };
      api_tokens: unknown[];
      exported_at: string;
    };

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("workhub-export.json");
    expect(payload.user.email).toBe("admin@workhub.test");
    expect(Array.isArray(payload.api_tokens)).toBe(true);
    expect(payload.exported_at).toBeTruthy();
  });

  test("POST /account/delete anonymizes a disposable user and clears the session", async () => {
    const email = `delete-me-${Date.now()}@workhub.test`;
    const passwordHash = await hashPassword("password");
    const inserted = (await getDatabase()`
      INSERT INTO users (name, email, email_lookup, role, tenant_id, password_hash, email_verified_at)
      VALUES (${"Disposable User"}, ${email}, ${email}, ${"member"}, 1, ${passwordHash}, NOW())
      RETURNING id
    `) as Array<{ id: number }>;
    const userId = inserted[0]?.id;
    expect(userId).toBeTruthy();

    const sessionCookie = await loginAndGetCookie(email, "password");
    const blockedCsrf = await fetchCsrfFromPath("/account", sessionCookie);
    const blockedDelete = await fetch(`${baseUrl}/account/delete`, {
      method: "POST",
      redirect: "manual",
      headers: {
        cookie: blockedCsrf.cookies,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        password: "password",
        confirm: "DELETE",
        _token: blockedCsrf.token,
      }),
    });
    expect(blockedDelete.status).toBe(302);
    expect(blockedDelete.headers.get("location")).toBe("/confirm-password?redirect=%2Faccount");

    const confirmedCookie = await confirmPasswordAndGetCookie(sessionCookie);
    const csrf = await fetchCsrfFromPath("/account", confirmedCookie);
    const wrong = await fetch(`${baseUrl}/account/delete`, {
      method: "POST",
      headers: {
        cookie: csrf.cookies,
        "content-type": "application/x-www-form-urlencoded",
        accept: "text/html",
      },
      body: new URLSearchParams({
        password: "not-the-password",
        confirm: "DELETE",
        _token: csrf.token,
      }),
    });

    expect(wrong.status).toBe(422);
    expect(await wrong.text()).toContain("Invalid credentials.");

    const deleted = await fetch(`${baseUrl}/account/delete`, {
      method: "POST",
      redirect: "manual",
      headers: {
        cookie: csrf.cookies,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        password: "password",
        confirm: "DELETE",
        _token: csrf.token,
      }),
    });

    expect(deleted.status).toBe(302);
    expect(deleted.headers.get("location")).toBe("/login");
    expect(deleted.headers.get("set-cookie")).toContain("workhub_session=");
    expect(
      readSetCookies(deleted).some((cookie) => cookie.startsWith("workhub_password_confirmed=")),
    ).toBe(true);

    const rows = (await getDatabase()`
      SELECT name, email FROM users WHERE id = ${userId}
    `) as Array<{ name: string; email: string }>;
    expect(rows[0]?.name).toBe("Deleted User");
    expect(rows[0]?.email).toContain("anonymous.local");
  });

  test("POST /account/mfa generates an authenticator secret", async () => {
    const csrf = await fetchCsrfFromPath("/account", adminSessionCookie);
    const response = await fetch(`${baseUrl}/account/mfa`, {
      method: "POST",
      headers: {
        cookie: csrf.cookies,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ _token: csrf.token }),
    });

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("mfa-secret");
    const secret = html.match(/class="mfa-secret">([^<]+)/)?.[1]?.trim();
    expect(secret).toBeTruthy();

    const confirmCsrf = await fetchCsrfFromPath("/account", adminSessionCookie);
    const confirmed = await fetch(`${baseUrl}/account/mfa/confirm`, {
      method: "POST",
      headers: {
        cookie: confirmCsrf.cookies,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        mfa_code: generateTotp(String(secret), Math.floor(Date.now() / 30_000)),
        _token: confirmCsrf.token,
      }),
    });
    const confirmedHtml = await confirmed.text();
    expect(confirmed.status).toBe(200);
    expect(confirmedHtml).toContain("recovery-codes");
    expect(confirmedHtml).toContain("Generate new recovery codes");

    const rotateCsrf = await fetchCsrfFromPath("/account", adminSessionCookie);
    const rotated = await fetch(`${baseUrl}/account/mfa/recovery-codes`, {
      method: "POST",
      headers: {
        cookie: rotateCsrf.cookies,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        password: "password",
        _token: rotateCsrf.token,
      }),
    });
    expect(rotated.status).toBe(200);
    expect(await rotated.text()).toContain("recovery-codes");

    const disableCsrf = await fetchCsrfFromPath("/account", adminSessionCookie);
    const disabled = await fetch(`${baseUrl}/account/mfa/disable`, {
      method: "POST",
      redirect: "manual",
      headers: {
        cookie: disableCsrf.cookies,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        password: "password",
        _token: disableCsrf.token,
      }),
    });
    expect(disabled.status).toBe(302);
  });

  test("admin can delete a newly created organization from HTML", async () => {
    const csrf = await fetchCsrfFromPath("/organizations", adminSessionCookie);
    const slug = `delete-org-${Date.now()}`;

    const createResponse = await fetch(`${baseUrl}/organizations`, {
      method: "POST",
      redirect: "manual",
      headers: {
        cookie: csrf.cookies,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        name: "Delete Me Org",
        slug,
        _token: csrf.token,
      }),
    });

    expect(createResponse.status).toBe(302);

    const list = await fetch(`${baseUrl}/organizations?per_page=100`, {
      headers: { cookie: mergeCookieHeader(csrf.cookies, createResponse) },
    });
    const listHtml = await list.text();
    const createdId = listHtml.match(
      new RegExp(
        `href="/organizations/(\\d+)"[^>]*>\\d+</a>\\s*</td>\\s*<td>Delete Me Org</td>\\s*<td>${slug}</td>`,
      ),
    )?.[1];

    expect(createdId).toBeTruthy();

    const deleteCsrf = await fetchCsrfFromPath(`/organizations/${createdId}`, adminSessionCookie);
    const deleteResponse = await fetch(`${baseUrl}/organizations/${createdId}/delete`, {
      method: "POST",
      redirect: "manual",
      headers: {
        cookie: deleteCsrf.cookies,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ _token: deleteCsrf.token }),
    });

    expect(deleteResponse.status).toBe(302);
    expect(deleteResponse.headers.get("location")).toBe("/organizations");
  });

  test("POST /logout clears the session cookie", async () => {
    const csrf = await fetchCsrfFromPath("/organizations", adminSessionCookie);
    const response = await fetch(`${baseUrl}/logout`, {
      method: "POST",
      redirect: "manual",
      headers: {
        cookie: csrf.cookies,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ _token: csrf.token }),
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/login");
    expect(response.headers.get("set-cookie")).toContain("workhub_session=");
    expect(
      readSetCookies(response).some((cookie) => cookie.startsWith("workhub_password_confirmed=")),
    ).toBe(true);
  });
});
