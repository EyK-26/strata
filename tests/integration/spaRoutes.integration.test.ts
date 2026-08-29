import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { hashApiToken } from "@getstrata/core/auth/tokenHash";
import { getDatabase } from "../../src/db/connection";
import { pinWorkhubIntegrationEnv } from "../helpers/integrationEnv";
import { restoreEnvVar } from "../helpers/restoreEnv";

const TEST_DATABASE_URL = process.env.DATABASE_URL;

if (!TEST_DATABASE_URL) {
  throw new Error("DATABASE_URL must be set before running integration tests.");
}

let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;
const previousFrontendMode = process.env.FRONTEND_MODE;
const DIST_DIR = join(process.cwd(), "frontend/dist");

beforeAll(async () => {
  mock.restore();
  pinWorkhubIntegrationEnv();
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.QUEUE_DRIVER = "sync";
  process.env.FRONTEND_MODE = "spa-react";

  await mkdir(DIST_DIR, { recursive: true });
  await writeFile(
    join(DIST_DIR, "index.html"),
    '<!doctype html><html><body><div id="root">WorkHub SPA</div></body></html>',
  );

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

afterAll(() => {
  server.stop(true);

  if (previousFrontendMode === undefined) {
    delete process.env.FRONTEND_MODE;
  } else {
    restoreEnvVar("FRONTEND_MODE", previousFrontendMode);
  }
});

describe("spa-react frontend routes", () => {
  test("GET / redirects to /app/", async () => {
    const response = await fetch(baseUrl, { redirect: "manual" });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/app/");
  });

  test("GET /app/ serves the SPA shell", async () => {
    const response = await fetch(`${baseUrl}/app/`);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("WorkHub SPA");
  });

  test("GET /app/organizations falls back to index.html for client routing", async () => {
    const response = await fetch(`${baseUrl}/app/organizations`);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("WorkHub SPA");
  });

  test("POST /api/v1/auth/login returns bearer token for SPA clients", async () => {
    const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "admin@workhub.test",
        password: "password",
      }),
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as { token: string };
    expect(body.token.length).toBeGreaterThan(20);

    const meResponse = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { authorization: `Bearer ${body.token}` },
    });

    expect(meResponse.status).toBe(200);
  });

  test("POST /api/v1/auth/register returns a bearer token for SPA clients", async () => {
    const email = `spa-register-${Date.now()}@workhub.test`;
    const response = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "SPA Register",
        email,
        password: "password123",
        password_confirmation: "password123",
      }),
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as { token: string; user: { email: string } };
    expect(body.token.length).toBeGreaterThan(20);
    expect(body.user.email).toBe(email);

    const meResponse = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { authorization: `Bearer ${body.token}` },
    });

    expect(meResponse.status).toBe(200);
    const me = (await meResponse.json()) as { email: string; role: string; id: number };
    expect(me).toMatchObject({ email, role: "member" });

    const organizations = await fetch(`${baseUrl}/api/v1/organizations`, {
      headers: { authorization: `Bearer ${body.token}` },
    });
    expect(organizations.status).toBe(200);
    const listed = (await organizations.json()) as {
      data: Array<{ id: number; name: string; slug: string }>;
    };
    expect(listed.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "SPA Register's workspace",
          slug: `personal-${me.id}`,
        }),
      ]),
    );
  });

  test("POST /api/v1/auth/forgot-password and reset-password rotate a password", async () => {
    const email = `spa-reset-${Date.now()}@workhub.test`;
    const registered = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "SPA Reset",
        email,
        password: "password123",
        password_confirmation: "password123",
      }),
    });
    expect(registered.status).toBe(201);

    const forgot = await fetch(`${baseUrl}/api/v1/auth/forgot-password`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    expect(forgot.status).toBe(200);
    expect(await forgot.json()).toEqual({
      message: "If that email exists, a reset link is on its way.",
    });

    const token = "spa-reset-token";
    await getDatabase()`
      UPDATE password_reset_token
      SET token = ${hashApiToken(token)}
      WHERE email = ${email}
    `;

    const reset = await fetch(`${baseUrl}/api/v1/auth/reset-password`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email,
        token,
        password: "password456",
        password_confirmation: "password456",
      }),
    });
    expect(reset.status).toBe(200);

    const oldLogin = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "password123" }),
    });
    expect(oldLogin.status).toBe(401);

    const newLogin = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "password456" }),
    });
    expect(newLogin.status).toBe(201);
    const body = (await newLogin.json()) as { token: string };
    expect(body.token.length).toBeGreaterThan(20);
  });

  test("POST /api/v1/auth/email/verification-notification does not leak accounts", async () => {
    const previous = process.env.FEATURE_EMAIL_VERIFICATION;
    process.env.FEATURE_EMAIL_VERIFICATION = "true";
    const email = `spa-verify-${Date.now()}@workhub.test`;

    try {
      const registered = await fetch(`${baseUrl}/api/v1/auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "SPA Verify",
          email,
          password: "password123",
          password_confirmation: "password123",
        }),
      });
      expect(registered.status).toBe(201);
      expect(await registered.json()).toEqual({
        user: expect.objectContaining({ email, role: "member" }),
      });

      const resend = await fetch(`${baseUrl}/api/v1/auth/email/verification-notification`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      expect(resend.status).toBe(200);
      expect(await resend.json()).toEqual({
        message: "If that account needs verification, a new link is on its way.",
      });

      const unknown = await fetch(`${baseUrl}/api/v1/auth/email/verification-notification`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: `missing-${Date.now()}@workhub.test` }),
      });
      expect(unknown.status).toBe(200);
      expect(await unknown.json()).toEqual({
        message: "If that account needs verification, a new link is on its way.",
      });
    } finally {
      restoreEnvVar("FEATURE_EMAIL_VERIFICATION", previous);
    }
  });
});
