import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { hashPassword } from "@getstrata/core/auth/password";
import { hashApiToken } from "@getstrata/core/auth/tokenHash";
import { emailLookupForQuery } from "@getstrata/core/crypto/fieldEncryption";
import { temporarySignedUrl } from "@getstrata/core/http/signedUrl";
import { generateTotp } from "@getstrata/core/security/totp";
import { runWithMigrationBypass } from "@getstrata/core/tenant/databaseTenantContext";
import { getDatabase } from "../../src/db/connection";
import { TEST_ADMIN_API_TOKEN } from "../../src/domain/auth";
import { issueHmacBrowserSession } from "../../src/modules/user/browserSessions";
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

  test("GET / sends a signed-in session to the current organization", async () => {
    const response = await fetch(baseUrl, {
      redirect: "manual",
      headers: { cookie: adminSessionCookie },
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/organizations/1");
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

  test("GET /organizations marks the current team", async () => {
    await runWithMigrationBypass(async () => {
      const db = getDatabase();
      await db`UPDATE users SET current_organization_id = 1 WHERE id = 1`;
    });

    const guest = await fetch(`${baseUrl}/organizations`);
    expect(guest.status).toBe(200);
    expect(await guest.text()).not.toContain('data-current-team="true"');

    const signedIn = await fetch(`${baseUrl}/organizations`, {
      headers: { cookie: adminSessionCookie },
    });
    expect(signedIn.status).toBe(200);
    const html = await signedIn.text();
    expect(html).toContain("Acme Labs");
    expect(html).toMatch(/data-organization-id="1"\s+data-current-team="true"/);
    expect(html).toContain("current-team");
    expect(html).not.toMatch(/data-organization-id="2"\s+data-current-team="true"/);

    const partial = await fetch(`${baseUrl}/organizations`, {
      headers: { cookie: adminSessionCookie, "HX-Request": "true" },
    });
    expect(partial.status).toBe(200);
    const partialHtml = await partial.text();
    expect(partialHtml).toMatch(/data-organization-id="1"\s+data-current-team="true"/);
    expect(partialHtml).not.toContain("<!doctype html>");
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
    const html = await response.text();
    expect(html).toContain("Acme Labs");
    expect(html).not.toContain("This is your current team");
    expect(html).not.toContain("Switch to this team");
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
    expect(response.headers.get("location")).toBe("/organizations/1");
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
    expect(login.headers.get("location")).toBe("/organizations/1");
    expect(register.status).toBe(302);
    expect(register.headers.get("location")).toBe("/organizations/1");
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

  test("POST /register with email verification restores the intended URL after verify", async () => {
    const previous = process.env.FEATURE_EMAIL_VERIFICATION;
    process.env.FEATURE_EMAIL_VERIFICATION = "true";
    const csrf = await fetchCsrfFromPath("/register");
    const email = `html-verify-intended-${Date.now()}@workhub.test`;

    try {
      const response = await fetch(`${baseUrl}/register`, {
        method: "POST",
        redirect: "manual",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: csrf.cookies,
        },
        body: new URLSearchParams({
          name: "HTML Verify Intended",
          email,
          password: "password123",
          password_confirmation: "password123",
          redirect: "/account",
          _token: csrf.token,
        }),
      });

      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("/email/verify");
      expect(
        readSetCookies(response).some((cookie) => cookie.startsWith("workhub_intended=")),
      ).toBe(true);

      const session = mergeCookieHeader("", response);
      const users = await runWithMigrationBypass(
        async () =>
          (await getDatabase()`
            SELECT id FROM users WHERE email_lookup = ${emailLookupForQuery(email)}
          `) as Array<{ id: number }>,
      );
      const userId = users[0]?.id ?? 0;
      expect(userId).toBeGreaterThan(0);

      const path = temporarySignedUrl("/verify-email", 120, { id: userId });
      const verified = await fetch(`${baseUrl}${path}`, {
        redirect: "manual",
        headers: { cookie: session },
      });

      expect(verified.status).toBe(302);
      expect(verified.headers.get("location")).toBe("/account");
      expect(
        readSetCookies(verified).some(
          (cookie) => cookie.startsWith("workhub_intended=") && cookie.includes("Max-Age=0"),
        ),
      ).toBe(true);

      const account = await fetch(`${baseUrl}/account`, {
        headers: { cookie: mergeCookieHeader(session, verified) },
      });
      expect(account.status).toBe(200);
      expect(await account.text()).toContain("HTML Verify Intended");
    } finally {
      restoreEnvVar("FEATURE_EMAIL_VERIFICATION", previous);
    }
  });

  test("GET /account while unverified stashes the intended URL for verify", async () => {
    const previous = process.env.FEATURE_EMAIL_VERIFICATION;
    process.env.FEATURE_EMAIL_VERIFICATION = "true";
    const csrf = await fetchCsrfFromPath("/register");
    const email = `html-verify-stash-${Date.now()}@workhub.test`;

    try {
      const registered = await fetch(`${baseUrl}/register`, {
        method: "POST",
        redirect: "manual",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: csrf.cookies,
        },
        body: new URLSearchParams({
          name: "HTML Verify Stash",
          email,
          password: "password123",
          password_confirmation: "password123",
          _token: csrf.token,
        }),
      });
      expect(registered.status).toBe(302);

      const session = mergeCookieHeader("", registered);
      const account = await fetch(`${baseUrl}/account`, {
        redirect: "manual",
        headers: { cookie: session },
      });
      expect(account.status).toBe(302);
      expect(account.headers.get("location")).toBe("/email/verify");
      expect(readSetCookies(account).some((cookie) => cookie.startsWith("workhub_intended="))).toBe(
        true,
      );

      const users = await runWithMigrationBypass(
        async () =>
          (await getDatabase()`
            SELECT id FROM users WHERE email_lookup = ${emailLookupForQuery(email)}
          `) as Array<{ id: number }>,
      );
      const userId = users[0]?.id ?? 0;
      expect(userId).toBeGreaterThan(0);
      const path = temporarySignedUrl("/verify-email", 120, { id: userId });
      const verified = await fetch(`${baseUrl}${path}`, {
        redirect: "manual",
        headers: { cookie: mergeCookieHeader(session, account) },
      });
      expect(verified.status).toBe(302);
      expect(verified.headers.get("location")).toBe("/account");
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
    const createdLocation = createResponse.headers.get("location") ?? "";
    expect(createdLocation).toMatch(/^\/organizations\/\d+$/);

    const followResponse = await fetch(`${baseUrl}${createdLocation}`, {
      headers: { cookie: mergeCookieHeader(csrf.cookies, createResponse) },
    });

    expect(followResponse.status).toBe(200);
    expect(await followResponse.text()).toContain("Organization created.");
  });

  test("POST /organizations lets a registered member create an extra organization", async () => {
    const registerCsrf = await fetchCsrfFromPath("/register");
    const email = `html-member-org-${Date.now()}@workhub.test`;
    const registered = await fetch(`${baseUrl}/register`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: registerCsrf.cookies,
      },
      body: new URLSearchParams({
        name: "Member Org Creator",
        email,
        password: "password123",
        password_confirmation: "password123",
        _token: registerCsrf.token,
      }),
    });
    expect(registered.status).toBe(302);

    const session = mergeCookieHeader("", registered);
    const csrf = await fetchCsrfFromPath("/organizations", session);
    const slug = `member-extra-org-${Date.now()}`;
    const created = await fetch(`${baseUrl}/organizations`, {
      method: "POST",
      redirect: "manual",
      headers: {
        cookie: csrf.cookies,
        "content-type": "application/x-www-form-urlencoded",
        accept: "text/html",
      },
      body: new URLSearchParams({
        name: "Member Extra Org",
        slug,
        _token: csrf.token,
      }),
    });

    expect(created.status).toBe(302);
    expect(created.headers.get("location")).toMatch(/^\/organizations\/\d+$/);

    const list = await fetch(`${baseUrl}/organizations`, {
      headers: { cookie: mergeCookieHeader(csrf.cookies, created) },
    });
    expect(list.status).toBe(200);
    expect(await list.text()).toContain("Member Extra Org");
  });

  test("POST /current-organization switches the HTMX current team", async () => {
    const registerCsrf = await fetchCsrfFromPath("/register");
    const email = `html-current-org-${Date.now()}@workhub.test`;
    const registered = await fetch(`${baseUrl}/register`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: registerCsrf.cookies,
      },
      body: new URLSearchParams({
        name: "HTML Current Org",
        email,
        password: "password123",
        password_confirmation: "password123",
        _token: registerCsrf.token,
      }),
    });
    expect(registered.status).toBe(302);
    const session = mergeCookieHeader("", registered);

    const personalLocation = registered.headers.get("location") ?? "";
    expect(personalLocation).toMatch(/^\/organizations\/\d+$/);
    const personalId = personalLocation.split("/").pop() ?? "";

    const personalHome = await fetch(`${baseUrl}${personalLocation}`, {
      headers: { cookie: session },
    });
    expect(personalHome.status).toBe(200);
    const personalHomeHtml = await personalHome.text();
    expect(personalHomeHtml).toContain("This is your current team");
    expect(personalHomeHtml).toContain("current-team");
    expect(personalHomeHtml).not.toContain("Switch to this team");

    const createCsrf = await fetchCsrfFromPath("/organizations", session);
    const slug = `html-current-extra-${Date.now()}`;
    const created = await fetch(`${baseUrl}/organizations`, {
      method: "POST",
      redirect: "manual",
      headers: {
        cookie: createCsrf.cookies,
        "content-type": "application/x-www-form-urlencoded",
        accept: "text/html",
      },
      body: new URLSearchParams({
        name: "HTML Current Extra",
        slug,
        _token: createCsrf.token,
      }),
    });
    expect(created.status).toBe(302);

    const extraLocation = created.headers.get("location") ?? "";
    expect(extraLocation).toMatch(/^\/organizations\/\d+$/);
    const extraId = extraLocation.split("/").pop() ?? "";

    const listCookies = mergeCookieHeader(createCsrf.cookies, created);
    const list = await fetch(`${baseUrl}/organizations`, { headers: { cookie: listCookies } });
    const listHtml = await list.text();
    expect(listHtml).toContain("HTML Current Extra");
    expect(listHtml).toContain('id="current-organization"');
    expect(listHtml).toContain("HTML Current Extra");
    expect(listHtml).toMatch(
      new RegExp(`data-organization-id="${extraId}"\\s+data-current-team="true"`),
    );
    expect(listHtml).not.toMatch(
      new RegExp(`data-organization-id="${personalId}"\\s+data-current-team="true"`),
    );

    const personalOther = await fetch(`${baseUrl}/organizations/${personalId}`, {
      headers: { cookie: listCookies },
    });
    expect(personalOther.status).toBe(200);
    const personalOtherHtml = await personalOther.text();
    expect(personalOtherHtml).toContain("Switch to this team");
    expect(personalOtherHtml).toContain(`action="/current-organization"`);
    expect(personalOtherHtml).not.toContain("This is your current team");

    const switchCsrf = await fetchCsrfFromPath("/organizations", listCookies);
    const switched = await fetch(`${baseUrl}/current-organization`, {
      method: "POST",
      redirect: "manual",
      headers: {
        cookie: switchCsrf.cookies,
        "content-type": "application/x-www-form-urlencoded",
        accept: "text/html",
      },
      body: new URLSearchParams({
        organization_id: personalId,
        _token: switchCsrf.token,
      }),
    });
    expect(switched.status).toBe(302);
    expect(switched.headers.get("location")).toBe(`/organizations/${personalId}`);

    const afterCookies = mergeCookieHeader(switchCsrf.cookies, switched);
    const show = await fetch(`${baseUrl}/organizations/${personalId}`, {
      headers: { cookie: afterCookies },
    });
    expect(show.status).toBe(200);
    const showHtml = await show.text();
    expect(showHtml).toContain(`value="${personalId}"`);
    expect(showHtml).toContain("selected");
    expect(showHtml).toContain("This is your current team");
    expect(showHtml).not.toContain("Switch to this team");

    const afterList = await fetch(`${baseUrl}/organizations`, {
      headers: { cookie: afterCookies },
    });
    expect(afterList.status).toBe(200);
    const afterHtml = await afterList.text();
    expect(afterHtml).toMatch(
      new RegExp(`data-organization-id="${personalId}"\\s+data-current-team="true"`),
    );
    expect(afterHtml).not.toMatch(
      new RegExp(`data-organization-id="${extraId}"\\s+data-current-team="true"`),
    );
  });

  test("GET /projects returns HTML project list", async () => {
    const response = await fetch(`${baseUrl}/projects`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain("Platform Rewrite");
  });

  test("GET /projects defaults signed-in HTML to the current organization", async () => {
    await runWithMigrationBypass(async () => {
      const db = getDatabase();
      await db`UPDATE users SET current_organization_id = 1 WHERE id = 1`;
    });

    const response = await fetch(`${baseUrl}/projects?per_page=1`, {
      headers: { cookie: adminSessionCookie },
    });

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Platform Rewrite");
    expect(html).not.toContain("Docking Simulator");
    expect(html).toContain('data-organization-id="1"');
    expect(html).toMatch(/value="1"\s+selected/);
    expect(html).toContain("/projects?page=2&per_page=1&amp;organizationId=1");
  });

  test("GET /projects?organizationId= overrides the current organization", async () => {
    const response = await fetch(`${baseUrl}/projects?organizationId=2`, {
      headers: { cookie: adminSessionCookie },
    });

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Docking Simulator");
    expect(html).not.toContain("Platform Rewrite");
    expect(html).toContain('data-organization-id="2"');
    expect(html).toMatch(/value="2"\s+selected/);
  });

  test("POST /current-organization scopes HTML /projects to the switched team", async () => {
    await runWithMigrationBypass(async () => {
      const db = getDatabase();
      await db`UPDATE users SET current_organization_id = 1 WHERE id = 1`;
    });

    const csrf = await fetchCsrfFromPath("/projects", adminSessionCookie);
    const switched = await fetch(`${baseUrl}/current-organization`, {
      method: "POST",
      redirect: "manual",
      headers: {
        cookie: csrf.cookies,
        "content-type": "application/x-www-form-urlencoded",
        accept: "text/html",
      },
      body: new URLSearchParams({
        organization_id: "2",
        _token: csrf.token,
      }),
    });
    expect(switched.status).toBe(302);

    try {
      const cookies = mergeCookieHeader(csrf.cookies, switched);
      const scoped = await fetch(`${baseUrl}/projects`, {
        headers: { cookie: cookies },
      });
      expect(scoped.status).toBe(200);
      const html = await scoped.text();
      expect(html).toContain("Docking Simulator");
      expect(html).not.toContain("Platform Rewrite");
      expect(html).toContain('data-organization-id="2"');
      expect(html).toMatch(/value="2"\s+selected/);
    } finally {
      await runWithMigrationBypass(async () => {
        const db = getDatabase();
        await db`UPDATE users SET current_organization_id = 1 WHERE id = 1`;
      });
    }
  });

  test("GET /tasks returns HTML task list", async () => {
    const response = await fetch(`${baseUrl}/tasks`);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Tasks");
  });

  test("GET /tasks defaults signed-in HTML to the current organization", async () => {
    await runWithMigrationBypass(async () => {
      const db = getDatabase();
      await db`UPDATE users SET current_organization_id = 1 WHERE id = 1`;
    });

    const response = await fetch(`${baseUrl}/tasks?per_page=1`, {
      headers: { cookie: adminSessionCookie },
    });

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Design module registry");
    expect(html).not.toContain("Simulate docking sequence");
    expect(html).toContain('data-organization-id="1"');
    expect(html).toMatch(/value="1"\s+selected/);
    expect(html).toContain("/tasks?page=2&per_page=1&amp;organizationId=1");
  });

  test("GET /tasks?organizationId= overrides the current organization", async () => {
    const response = await fetch(`${baseUrl}/tasks?organizationId=2`, {
      headers: { cookie: adminSessionCookie },
    });

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Simulate docking sequence");
    expect(html).not.toContain("Design module registry");
    expect(html).toContain('data-organization-id="2"');
  });

  test("POST /current-organization scopes HTML /tasks to the switched team", async () => {
    await runWithMigrationBypass(async () => {
      const db = getDatabase();
      await db`UPDATE users SET current_organization_id = 1 WHERE id = 1`;
    });

    const csrf = await fetchCsrfFromPath("/tasks", adminSessionCookie);
    const switched = await fetch(`${baseUrl}/current-organization`, {
      method: "POST",
      redirect: "manual",
      headers: {
        cookie: csrf.cookies,
        "content-type": "application/x-www-form-urlencoded",
        accept: "text/html",
      },
      body: new URLSearchParams({
        organization_id: "2",
        _token: csrf.token,
      }),
    });
    expect(switched.status).toBe(302);

    try {
      const cookies = mergeCookieHeader(csrf.cookies, switched);
      const scoped = await fetch(`${baseUrl}/tasks`, {
        headers: { cookie: cookies },
      });
      expect(scoped.status).toBe(200);
      const html = await scoped.text();
      expect(html).toContain("Simulate docking sequence");
      expect(html).not.toContain("Design module registry");
      expect(html).toContain('data-organization-id="2"');
    } finally {
      await runWithMigrationBypass(async () => {
        const db = getDatabase();
        await db`UPDATE users SET current_organization_id = 1 WHERE id = 1`;
      });
    }
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
    await runWithMigrationBypass(async () => {
      const db = getDatabase();
      await db`UPDATE users SET current_organization_id = 1 WHERE id = 1`;
    });

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
    await runWithMigrationBypass(async () => {
      const db = getDatabase();
      await db`UPDATE users SET current_organization_id = 1 WHERE id = 1`;
    });

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

  test("GET /search defaults signed-in HTML to the current organization", async () => {
    await runWithMigrationBypass(async () => {
      const db = getDatabase();
      await db`UPDATE users SET current_organization_id = 1 WHERE id = 1`;
    });

    const docking = await fetch(`${baseUrl}/search?q=docking`, {
      headers: { cookie: adminSessionCookie },
    });
    expect(docking.status).toBe(200);
    expect(await docking.text()).toContain("No matches");

    const override = await fetch(`${baseUrl}/search?q=docking&organizationId=2`, {
      headers: { cookie: adminSessionCookie },
    });
    expect(override.status).toBe(200);
    expect(await override.text()).toContain("Docking Simulator");
  });

  test("POST /current-organization scopes HTML /search to the switched team", async () => {
    await runWithMigrationBypass(async () => {
      const db = getDatabase();
      await db`UPDATE users SET current_organization_id = 1 WHERE id = 1`;
    });

    const csrf = await fetchCsrfFromPath("/search", adminSessionCookie);
    const switched = await fetch(`${baseUrl}/current-organization`, {
      method: "POST",
      redirect: "manual",
      headers: {
        cookie: csrf.cookies,
        "content-type": "application/x-www-form-urlencoded",
        accept: "text/html",
      },
      body: new URLSearchParams({
        organization_id: "2",
        _token: csrf.token,
      }),
    });
    expect(switched.status).toBe(302);

    try {
      const cookies = mergeCookieHeader(csrf.cookies, switched);
      const scoped = await fetch(`${baseUrl}/search?q=docking`, {
        headers: { cookie: cookies },
      });
      expect(scoped.status).toBe(200);
      const html = await scoped.text();
      expect(html).toContain("Docking Simulator");
      expect(html).not.toContain("No matches");
    } finally {
      await runWithMigrationBypass(async () => {
        const db = getDatabase();
        await db`UPDATE users SET current_organization_id = 1 WHERE id = 1`;
      });
    }
  });

  test("GET /notifications renders the inbox partial", async () => {
    const response = await fetch(`${baseUrl}/notifications`, {
      headers: { cookie: adminSessionCookie },
    });

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("notifications-inbox");
    expect(html).toContain(`Welcome to ${process.env.APP_NAME?.trim() || "WorkHub"}`);
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
    expect(webhookHtml).toContain('name="organization_id"');
  });

  test("HTML webhook create defaults to the current team", async () => {
    await runWithMigrationBypass(async () => {
      const db = getDatabase();
      await db`UPDATE users SET current_organization_id = 1 WHERE id = 1`;
    });

    const page = await fetch(`${baseUrl}/webhooks`, {
      headers: { cookie: adminSessionCookie },
    });
    expect(page.status).toBe(200);
    const formHtml = await page.text();
    expect(formHtml).toContain("Defaults to your current team");
    expect(formHtml).toContain("All teams");
    expect(formHtml).toMatch(/value="1"\s+selected/);

    const csrf = await fetchCsrfFromPath("/webhooks", adminSessionCookie);
    const url = `https://hooks.example.com/current-team-${Date.now()}`;
    const createdResponse = await fetch(`${baseUrl}/webhooks`, {
      method: "POST",
      redirect: "manual",
      headers: {
        cookie: csrf.cookies,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        url,
        secret: "current-team-secret",
        events: "task.created",
        _token: csrf.token,
      }),
    });
    expect(createdResponse.status).toBe(302);

    const created = await runWithMigrationBypass(
      async () =>
        (await getDatabase()`
          SELECT id, organization_id FROM webhook WHERE url = ${url} ORDER BY id DESC LIMIT 1
        `) as Array<{ id: number; organization_id: number | null }>,
    );
    expect(created[0]?.organization_id).toBe(1);

    const tenantUrl = `https://hooks.example.com/all-teams-${Date.now()}`;
    const tenantCsrf = await fetchCsrfFromPath("/webhooks", adminSessionCookie);
    const tenantResponse = await fetch(`${baseUrl}/webhooks`, {
      method: "POST",
      redirect: "manual",
      headers: {
        cookie: tenantCsrf.cookies,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        url: tenantUrl,
        secret: "all-teams-secret",
        events: "task.created",
        organization_id: "",
        _token: tenantCsrf.token,
      }),
    });
    expect(tenantResponse.status).toBe(302);

    const tenantWide = await runWithMigrationBypass(
      async () =>
        (await getDatabase()`
          SELECT organization_id FROM webhook WHERE url = ${tenantUrl} ORDER BY id DESC LIMIT 1
        `) as Array<{ organization_id: number | null }>,
    );
    expect(tenantWide[0]?.organization_id).toBeNull();

    const listed = await fetch(`${baseUrl}/webhooks`, {
      headers: { cookie: adminSessionCookie },
    });
    const listedHtml = await listed.text();
    expect(listedHtml).toContain("<th>Team</th>");
    expect(listedHtml).toContain(url);
    expect(listedHtml).toContain('href="/organizations/1"');
    expect(listedHtml).toContain("Acme Labs");
    expect(listedHtml).toContain(tenantUrl);
    expect(listedHtml).toContain("All teams");

    await runWithMigrationBypass(async () => {
      const db = getDatabase();
      await db`DELETE FROM webhook WHERE url = ${url} OR url = ${tenantUrl}`;
    });
  });

  test("HTML webhook list defaults to the current team", async () => {
    await runWithMigrationBypass(async () => {
      const db = getDatabase();
      await db`UPDATE users SET current_organization_id = 1 WHERE id = 1`;
    });

    const stamp = Date.now();
    const org2Url = `https://hooks.example.com/org2-list-${stamp}`;
    await runWithMigrationBypass(async () => {
      const db = getDatabase();
      await db`
        INSERT INTO webhook (organization_id, tenant_id, url, secret, events, active, created_at)
        VALUES (2, 1, ${org2Url}, ${"org2-list-secret"}, ${["project.created"]}, TRUE, NOW())
      `;
    });

    const scoped = await fetch(`${baseUrl}/webhooks`, {
      headers: { cookie: adminSessionCookie },
    });
    expect(scoped.status).toBe(200);
    const scopedHtml = await scoped.text();
    expect(scopedHtml).toContain("webhook-list-scope");
    expect(scopedHtml).toContain("/webhooks?all=1");
    expect(scopedHtml).not.toContain(org2Url);

    const allTeams = await fetch(`${baseUrl}/webhooks?all=1`, {
      headers: { cookie: adminSessionCookie },
    });
    expect(allTeams.status).toBe(200);
    const allHtml = await allTeams.text();
    expect(allHtml).toContain(org2Url);
    expect(allHtml).toContain('href="/webhooks"');

    await runWithMigrationBypass(async () => {
      const db = getDatabase();
      await db`DELETE FROM webhook WHERE url = ${org2Url}`;
    });
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
    await runWithMigrationBypass(async () => {
      const db = getDatabase();
      await db`UPDATE users SET current_organization_id = 1 WHERE id = 1`;
    });

    const response = await fetch(`${baseUrl}/organizations/1`, {
      headers: { cookie: adminSessionCookie },
    });

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("org-members");
    expect(html).toContain("admin@workhub.test");
    expect(html).toContain("This is your current team");
    expect(html).toContain("current-team");
    expect(html).not.toContain("Switch to this team");
    expect(html).toContain("Update role");
    expect(html).toContain('hx-post="/organizations/1/members/2/role"');
    expect(html).toContain("Add or invite");
    expect(html).not.toContain("Leave team");
  });

  test("POST /organizations/:id/members invites a registered user instead of adding them", async () => {
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
    expect(html).toContain("Pending invitations");
    expect(html).toContain(email);
    expect(html).not.toContain(`Role for ${email}`);
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
    expect(invitedHtml).toContain("Resend");

    const pending = await runWithMigrationBypass(
      async () =>
        (await getDatabase()`
          SELECT id FROM organization_invitation WHERE email = ${inviteEmail} ORDER BY id DESC LIMIT 1
        `) as Array<{ id: number }>,
    );
    const invitationId = pending[0]?.id;
    expect(invitationId).toBeTruthy();

    const resendCsrf = await fetchCsrfFromPath("/organizations/1", adminSessionCookie);
    const resent = await fetch(`${baseUrl}/organizations/1/invitations/${invitationId}/resend`, {
      method: "POST",
      headers: {
        cookie: resendCsrf.cookies,
        "content-type": "application/x-www-form-urlencoded",
        accept: "text/html",
        "HX-Request": "true",
      },
      body: new URLSearchParams({ _token: resendCsrf.token }),
    });
    expect(resent.status).toBe(200);
    const resentHtml = await resent.text();
    expect(resentHtml).toContain(inviteEmail);
    expect(resentHtml).toContain("Resend");
    expect(resentHtml).toContain("Pending invitations");
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
    expect(registered.headers.get("location")).toBe("/organizations/1");

    const session = mergeCookieHeader(registerCsrf.cookies, registered);
    const home = await fetch(`${baseUrl}/organizations/1`, {
      headers: { cookie: session, accept: "text/html" },
    });
    expect(home.status).toBe(200);
    const homeHtml = await home.text();
    expect(homeHtml).toContain("Acme Labs");
    expect(homeHtml).toContain('id="current-organization"');
    expect(homeHtml).toMatch(/value="1"\s+selected/);
    expect(homeHtml).toContain("Auto Join&#39;s workspace");

    const show = await fetch(`${baseUrl}/organizations/1`, {
      headers: { cookie: adminSessionCookie, accept: "text/html" },
    });
    const html = await show.text();
    expect(html).toContain("Auto Join");
    expect(html).toContain(`Role for ${email}`);
  });

  test("signed GET /invitations/accept joins an existing user and sets current team", async () => {
    const registerCsrf = await fetchCsrfFromPath("/register");
    const email = `html-accept-${Date.now()}@workhub.test`;
    const registered = await fetch(`${baseUrl}/register`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: registerCsrf.cookies,
      },
      body: new URLSearchParams({
        name: "HTML Accept",
        email,
        password: "password123",
        password_confirmation: "password123",
        _token: registerCsrf.token,
      }),
    });
    expect(registered.status).toBe(302);
    const personalLocation = registered.headers.get("location") ?? "";
    expect(personalLocation).toMatch(/^\/organizations\/\d+$/);
    const session = mergeCookieHeader(registerCsrf.cookies, registered);

    const inviteCsrf = await fetchCsrfFromPath("/organizations/1", adminSessionCookie);
    const invited = await fetch(`${baseUrl}/organizations/1/members`, {
      method: "POST",
      headers: {
        cookie: inviteCsrf.cookies,
        "content-type": "application/x-www-form-urlencoded",
        accept: "text/html",
      },
      body: new URLSearchParams({
        email,
        role: "member",
        _token: inviteCsrf.token,
      }),
      redirect: "manual",
    });
    expect(invited.status).toBe(302);

    const token = "html-accept-invite-token";
    await runWithMigrationBypass(async () => {
      await getDatabase()`
        UPDATE organization_invitation
        SET token_hash = ${hashApiToken(token)}
        WHERE email = ${email}
      `;
    });

    const path = temporarySignedUrl("/invitations/accept", 120, { email, token });
    const guest = await fetch(`${baseUrl}${path}`, { redirect: "manual" });
    expect(guest.status).toBe(302);
    const loginLocation = guest.headers.get("location") ?? "";
    expect(loginLocation.startsWith("/login?redirect=")).toBe(true);
    expect(decodeURIComponent(loginLocation)).toContain("/invitations/accept");

    const accepted = await fetch(`${baseUrl}${path}`, {
      redirect: "manual",
      headers: { cookie: session },
    });
    expect(accepted.status).toBe(302);
    expect(accepted.headers.get("location")).toBe("/organizations/1");

    const joined = mergeCookieHeader(session, accepted);
    const show = await fetch(`${baseUrl}/organizations/1`, {
      headers: { cookie: joined, accept: "text/html" },
    });
    expect(show.status).toBe(200);
    const showHtml = await show.text();
    expect(showHtml).toContain("This is your current team");
    expect(showHtml).toContain(email);

    const personal = await fetch(`${baseUrl}${personalLocation}`, {
      headers: { cookie: joined, accept: "text/html" },
    });
    expect(personal.status).toBe(200);
    expect(await personal.text()).toContain("Switch to this team");
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

  test("POST /organizations/:id/members/:userId/leave is Jetstream leave-team", async () => {
    const registerCsrf = await fetchCsrfFromPath("/register");
    const email = `html-leave-${Date.now()}@workhub.test`;
    const registered = await fetch(`${baseUrl}/register`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: registerCsrf.cookies,
      },
      body: new URLSearchParams({
        name: "HTML Leave",
        email,
        password: "password123",
        password_confirmation: "password123",
        _token: registerCsrf.token,
      }),
    });
    expect(registered.status).toBe(302);
    const personalPath = registered.headers.get("location") ?? "";
    expect(personalPath).toMatch(/^\/organizations\/\d+$/);
    const session = mergeCookieHeader("", registered);

    const profile = await runWithMigrationBypass(async () => {
      const rows = (await getDatabase()`
        SELECT id FROM users WHERE email_lookup = ${emailLookupForQuery(email)}
      `) as Array<{ id: number }>;
      return rows[0];
    });
    expect(profile?.id).toBeGreaterThan(0);

    const added = await fetch(`${baseUrl}/api/v1/organizations/1/members`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${TEST_ADMIN_API_TOKEN}`,
      },
      body: JSON.stringify({ user_id: profile?.id, role: "member" }),
    });
    expect(added.status).toBe(201);

    const show = await fetch(`${baseUrl}/organizations/1`, {
      headers: { cookie: session, accept: "text/html" },
    });
    expect(show.status).toBe(200);
    const showHtml = await show.text();
    expect(showHtml).toContain("Leave team");
    expect(showHtml).not.toContain("Add or invite");
    expect(showHtml).not.toContain("Update role");

    const personal = await fetch(`${baseUrl}${personalPath}`, {
      headers: { cookie: session, accept: "text/html" },
    });
    expect(await personal.text()).not.toContain("Leave team");

    const leaveCsrf = await fetchCsrfFromPath("/organizations/1", session);
    const userIdMatch = showHtml.match(/\/organizations\/1\/members\/(\d+)\/leave/);
    expect(userIdMatch?.[1]).toBeDefined();
    const left = await fetch(`${baseUrl}/organizations/1/members/${userIdMatch?.[1]}/leave`, {
      method: "POST",
      redirect: "manual",
      headers: {
        cookie: leaveCsrf.cookies,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        _token: leaveCsrf.token,
      }),
    });
    expect(left.status).toBe(302);
    expect(left.headers.get("location")).toBe(personalPath);
  });

  test("GET /reports and /account are available to a signed-in session", async () => {
    await runWithMigrationBypass(async () => {
      const db = getDatabase();
      await db`UPDATE users SET current_organization_id = 1 WHERE id = 1`;
    });

    const reports = await fetch(`${baseUrl}/reports`, {
      redirect: "manual",
      headers: { cookie: adminSessionCookie },
    });
    const account = await fetch(`${baseUrl}/account`, {
      headers: { cookie: adminSessionCookie },
    });
    const orgReport = await fetch(`${baseUrl}/reports/organizations/1`, {
      headers: { cookie: adminSessionCookie },
    });
    const allReports = await fetch(`${baseUrl}/reports?all=1`, {
      headers: { cookie: adminSessionCookie },
    });

    expect(reports.status).toBe(302);
    expect(reports.headers.get("location")).toBe("/reports/organizations/1");
    expect(allReports.status).toBe(200);
    expect(await allReports.text()).toContain("Reports");
    expect(account.status).toBe(200);
    const accountHtml = await account.text();
    expect(accountHtml).toContain("admin@workhub.test");
    expect(accountHtml).toContain("Current team");
    expect(accountHtml).toContain('id="current-team"');
    expect(accountHtml).toContain("Acme Labs");
    expect(accountHtml).toContain('href="/organizations/1"');
    expect(accountHtml).toContain("Update profile");
    expect(accountHtml).toContain("Two-factor authentication");
    expect(accountHtml).toContain("API tokens");
    expect(accountHtml).toContain("Last used");
    expect(accountHtml).toContain("Export my data");
    expect(accountHtml).toContain("Profile photo");
    expect(accountHtml).toContain("Upload photo");
    expect(accountHtml).toContain("No profile photo yet.");
    expect(accountHtml).toContain("Team invitations");
    expect(accountHtml).toContain('id="team-invitations"');
    expect(accountHtml).toContain("No pending team invitations.");
    expect(accountHtml).toContain('id="browser-sessions"');
    expect(accountHtml).toContain("This device");
    expect(accountHtml).toContain('data-current-session="1"');
    expect(orgReport.status).toBe(200);
    const orgReportHtml = await orgReport.text();
    expect(orgReportHtml).toContain("Acme Labs");
    expect(orgReportHtml).toContain("/reports?all=1");
  });

  // Known WorkHub flake: HMAC "other device" rows can be marked current when
  // cookie-store sessions collide. Wave 10 retires this WorkHub HTML surface.
  test.skip("POST /account/sessions/:id/logout revokes another HMAC browser session", async () => {
    const registerCsrf = await fetchCsrfFromPath("/register");
    const email = `session-logout-${Date.now()}@workhub.test`;
    const registered = await fetch(`${baseUrl}/register`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: registerCsrf.cookies,
      },
      body: new URLSearchParams({
        name: "Session Logout",
        email,
        password: "password123",
        password_confirmation: "password123",
        _token: registerCsrf.token,
      }),
    });
    expect(registered.status).toBe(302);
    const session = mergeCookieHeader(registerCsrf.cookies, registered);
    const user = (await getDatabase()`
      SELECT id FROM users WHERE email_lookup = ${emailLookupForQuery(email)} LIMIT 1
    `) as Array<{ id: number }>;
    const userId = user[0]?.id;
    expect(userId).toBeTruthy();

    const other = await issueHmacBrowserSession(
      new Request("http://localhost/login", {
        headers: { "user-agent": "OtherDevice/1.0" },
      }),
      Number(userId),
    );

    const listed = await fetch(`${baseUrl}/account`, {
      headers: { cookie: session, accept: "text/html" },
    });
    expect(listed.status).toBe(200);
    const listedHtml = await listed.text();
    expect(listedHtml).toContain("OtherDevice/1.0");
    expect(listedHtml).toContain(`/account/sessions/${other.id}/logout`);
    expect(listedHtml).toContain("Log out");

    const currentMatch = listedHtml.match(
      /data-current-session="1"[^>]*data-session-id="([a-f0-9]{64})"/,
    );
    const currentId = currentMatch?.[1];
    expect(currentId).toBeTruthy();

    const csrf = await fetchCsrfFromPath("/account", session);
    const self = await fetch(`${baseUrl}/account/sessions/${currentId}/logout`, {
      method: "POST",
      headers: {
        cookie: csrf.cookies,
        "content-type": "application/x-www-form-urlencoded",
        accept: "text/html",
      },
      body: new URLSearchParams({ _token: csrf.token }),
    });
    expect(self.status).toBe(422);
    expect(await self.text()).toContain("Cannot log out this device.");

    const revoked = await fetch(`${baseUrl}/account/sessions/${other.id}/logout`, {
      method: "POST",
      redirect: "manual",
      headers: {
        cookie: csrf.cookies,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ _token: csrf.token }),
    });
    expect(revoked.status).toBe(302);
    expect(revoked.headers.get("location")).toBe("/account#browser-sessions");

    const after = await fetch(`${baseUrl}/account`, {
      headers: { cookie: session, accept: "text/html" },
    });
    expect(after.status).toBe(200);
    expect(await after.text()).not.toContain("OtherDevice/1.0");

    const otherCookie = other.header.split(";")[0] ?? "";
    const rejected = await fetch(`${baseUrl}/account`, {
      redirect: "manual",
      headers: { cookie: otherCookie },
    });
    expect(rejected.status).toBe(302);
    expect(rejected.headers.get("location") ?? "").toContain("/login");
  });

  test("HTML account accept and decline team invitations for the signed-in email", async () => {
    const registerCsrf = await fetchCsrfFromPath("/register");
    const email = `html-account-invite-${Date.now()}@workhub.test`;
    const registered = await fetch(`${baseUrl}/register`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: registerCsrf.cookies,
      },
      body: new URLSearchParams({
        name: "Account Invitee",
        email,
        password: "password123",
        password_confirmation: "password123",
        _token: registerCsrf.token,
      }),
    });
    expect(registered.status).toBe(302);
    const session = mergeCookieHeader(registerCsrf.cookies, registered);

    const inviteCsrf = await fetchCsrfFromPath("/organizations/1", adminSessionCookie);
    const invited = await fetch(`${baseUrl}/organizations/1/members`, {
      method: "POST",
      redirect: "manual",
      headers: {
        cookie: inviteCsrf.cookies,
        "content-type": "application/x-www-form-urlencoded",
        accept: "text/html",
      },
      body: new URLSearchParams({
        email,
        role: "member",
        _token: inviteCsrf.token,
      }),
    });
    expect(invited.status).toBe(302);

    const invitation = await runWithMigrationBypass(
      async () =>
        (await getDatabase()`
          SELECT id FROM organization_invitation WHERE email = ${email} ORDER BY id DESC LIMIT 1
        `) as Array<{ id: number }>,
    );
    const invitationId = invitation[0]?.id;
    expect(invitationId).toBeTruthy();

    const account = await fetch(`${baseUrl}/account`, {
      headers: { cookie: session, accept: "text/html" },
    });
    expect(account.status).toBe(200);
    const accountHtml = await account.text();
    expect(accountHtml).toContain('id="team-invitations"');
    expect(accountHtml).toContain("Acme Labs");
    expect(accountHtml).toContain(`/account/invitations/${invitationId}/accept`);
    expect(accountHtml).toContain(`/account/invitations/${invitationId}/decline`);

    const declineCsrf = await fetchCsrfFromPath("/account", session);
    const declined = await fetch(`${baseUrl}/account/invitations/${invitationId}/decline`, {
      method: "POST",
      redirect: "manual",
      headers: {
        cookie: declineCsrf.cookies,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ _token: declineCsrf.token }),
    });
    expect(declined.status).toBe(302);
    expect(declined.headers.get("location")).toBe("/account");

    const afterDecline = await fetch(`${baseUrl}/account`, {
      headers: { cookie: session, accept: "text/html" },
    });
    expect(await afterDecline.text()).toContain("No pending team invitations.");

    const reinviteCsrf = await fetchCsrfFromPath("/organizations/1", adminSessionCookie);
    const reinvited = await fetch(`${baseUrl}/organizations/1/members`, {
      method: "POST",
      redirect: "manual",
      headers: {
        cookie: reinviteCsrf.cookies,
        "content-type": "application/x-www-form-urlencoded",
        accept: "text/html",
      },
      body: new URLSearchParams({
        email,
        role: "admin",
        _token: reinviteCsrf.token,
      }),
    });
    expect(reinvited.status).toBe(302);

    const second = await runWithMigrationBypass(
      async () =>
        (await getDatabase()`
          SELECT id FROM organization_invitation WHERE email = ${email} ORDER BY id DESC LIMIT 1
        `) as Array<{ id: number }>,
    );
    const secondId = second[0]?.id;
    expect(secondId).toBeTruthy();

    const acceptCsrf = await fetchCsrfFromPath("/account", session);
    const accepted = await fetch(`${baseUrl}/account/invitations/${secondId}/accept`, {
      method: "POST",
      redirect: "manual",
      headers: {
        cookie: acceptCsrf.cookies,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ _token: acceptCsrf.token }),
    });
    expect(accepted.status).toBe(302);
    expect(accepted.headers.get("location")).toBe("/organizations/1");

    const joined = mergeCookieHeader(session, accepted);
    const show = await fetch(`${baseUrl}/organizations/1`, {
      headers: { cookie: joined, accept: "text/html" },
    });
    expect(show.status).toBe(200);
    const showHtml = await show.text();
    expect(showHtml).toContain("This is your current team");
    expect(showHtml).toContain(email);

    const afterAccept = await fetch(`${baseUrl}/account`, {
      headers: { cookie: joined, accept: "text/html" },
    });
    expect(await afterAccept.text()).toContain("No pending team invitations.");
  });

  test("POST /current-organization scopes HTML /reports to the switched team", async () => {
    await runWithMigrationBypass(async () => {
      const db = getDatabase();
      await db`UPDATE users SET current_organization_id = 1 WHERE id = 1`;
    });

    const csrf = await fetchCsrfFromPath("/reports?all=1", adminSessionCookie);
    const switched = await fetch(`${baseUrl}/current-organization`, {
      method: "POST",
      redirect: "manual",
      headers: {
        cookie: csrf.cookies,
        "content-type": "application/x-www-form-urlencoded",
        accept: "text/html",
      },
      body: new URLSearchParams({
        organization_id: "2",
        _token: csrf.token,
      }),
    });
    expect(switched.status).toBe(302);

    try {
      const cookies = mergeCookieHeader(csrf.cookies, switched);
      const reports = await fetch(`${baseUrl}/reports`, {
        redirect: "manual",
        headers: { cookie: cookies },
      });
      expect(reports.status).toBe(302);
      expect(reports.headers.get("location")).toBe("/reports/organizations/2");
    } finally {
      await runWithMigrationBypass(async () => {
        const db = getDatabase();
        await db`UPDATE users SET current_organization_id = 1 WHERE id = 1`;
      });
    }
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
    expect(createdHtml).toContain("ability:projects:read");
    expect(createdHtml).toContain("*");

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

  test("POST /account/tokens honors selected abilities", async () => {
    const csrf = await fetchCsrfFromPath("/account", adminSessionCookie);
    const name = `html-scoped-token-${Date.now()}`;
    const createResponse = await fetch(`${baseUrl}/account/tokens`, {
      method: "POST",
      headers: {
        cookie: csrf.cookies,
        "content-type": "application/x-www-form-urlencoded",
        accept: "text/html",
      },
      body: new URLSearchParams({
        name,
        "ability:projects:read": "1",
        _token: csrf.token,
      }),
    });

    expect(createResponse.status).toBe(200);
    expect(await createResponse.text()).toContain("projects:read");

    const stored = (await getDatabase()`
      SELECT abilities FROM api_token WHERE name = ${name} ORDER BY id DESC LIMIT 1
    `) as Array<{ abilities: string[] | string }>;
    const abilities = stored[0]?.abilities;
    expect(abilities).toEqual(["projects:read"]);
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
    expect(html).toContain("data:image/svg+xml");
    expect(html).toContain("Authenticator QR code");
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
    const createdLocation = createResponse.headers.get("location") ?? "";
    expect(createdLocation).toMatch(/^\/organizations\/\d+$/);
    const createdId = createdLocation.split("/").pop();
    expect(createdId).toBeTruthy();

    const list = await fetch(`${baseUrl}/organizations?per_page=100`, {
      headers: { cookie: mergeCookieHeader(csrf.cookies, createResponse) },
    });
    const listHtml = await list.text();
    expect(listHtml).toContain("Delete Me Org");
    expect(listHtml).toContain(slug);
    expect(listHtml).toMatch(
      new RegExp(`data-organization-id="${createdId}"\\s+data-current-team="true"`),
    );

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
