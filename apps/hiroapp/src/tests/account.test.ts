import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { generateTotp } from "@getstrata/core/security/totp";
import { authManager } from "../http/currentUser.ts";
import { users } from "../modules/users/repository.ts";
import { bootHiroapp, collectCookies, cookieHeader, csrfFrom, signInCookie } from "./helpers.ts";

const enabled = process.env.HIROAPP_TEST === "1";

describe.skipIf(!enabled)("Wave 6 staff identity", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl = "";
  let candidateCookies: string[] = [];
  let recruiterCookies: string[] = [];
  let adminCookies: string[] = [];

  beforeAll(async () => {
    const boot = await bootHiroapp();
    server = boot.server;
    baseUrl = boot.baseUrl;
    candidateCookies = (await signInCookie("candidate@hiroapp.com")).cookies;
    recruiterCookies = (await signInCookie("recruiter@hiroapp.com")).cookies;
    adminCookies = (await signInCookie("admin@hiroapp.com")).cookies;
  });

  afterAll(() => {
    server?.stop(true);
  });

  async function request(path: string, init: RequestInit & { cookies?: string[] } = {}) {
    const cookies = init.cookies ?? [];
    const headers = new Headers(init.headers);
    if (cookies.length) {
      headers.set("cookie", cookieHeader(cookies));
    }
    const response = await fetch(`${baseUrl}${path}`, { ...init, headers, redirect: "manual" });
    return {
      response,
      cookies: collectCookies(response, cookies),
      text: await response.text(),
    };
  }

  async function jsonRequest(path: string, init: RequestInit & { cookies?: string[] } = {}) {
    const primed = await request("/api/skills", { cookies: init.cookies });
    const token = csrfFrom(primed.cookies);
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    if (init.method && init.method !== "GET") {
      headers.set("x-csrf-token", token);
      if (!headers.has("content-type")) {
        headers.set("content-type", "application/json");
      }
    }
    const result = await request(path, {
      ...init,
      cookies: primed.cookies,
      headers,
    });
    return {
      ...result,
      body: result.text ? JSON.parse(result.text) : null,
    };
  }

  async function guestJson(path: string, init: RequestInit & { cookies?: string[] } = {}) {
    const primed = await request("/login", { cookies: init.cookies });
    const token = csrfFrom(primed.cookies);
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    if (init.method && init.method !== "GET") {
      headers.set("x-csrf-token", token);
      if (!headers.has("content-type")) {
        headers.set("content-type", "application/json");
      }
    }
    const result = await request(path, {
      ...init,
      cookies: primed.cookies,
      headers,
    });
    return {
      ...result,
      body: result.text ? JSON.parse(result.text) : null,
    };
  }

  test("candidate can update profile and password", async () => {
    const patched = await jsonRequest("/api/users/me", {
      cookies: candidateCookies,
      method: "PATCH",
      body: JSON.stringify({
        first_name: "Pat",
        last_name: "Candidate",
        email: "candidate@hiroapp.com",
      }),
    });
    expect(patched.response.status).toBe(200);
    expect(patched.body.first_name).toBe("Pat");

    const password = await jsonRequest("/api/users/me/password", {
      cookies: candidateCookies,
      method: "PUT",
      body: JSON.stringify({
        current_password: "password",
        password: "password1",
        password_confirmation: "password1",
      }),
    });
    expect(password.response.status).toBe(200);
    await jsonRequest("/api/users/me/password", {
      cookies: candidateCookies,
      method: "PUT",
      body: JSON.stringify({
        current_password: "password1",
        password: "password",
        password_confirmation: "password",
      }),
    });
  });

  test("candidate is forbidden from MFA, tokens, and session manager", async () => {
    const mfa = await jsonRequest("/api/users/me/mfa", {
      cookies: candidateCookies,
      method: "POST",
    });
    expect(mfa.response.status).toBe(403);

    const sessions = await jsonRequest("/api/users/me/sessions", {
      cookies: candidateCookies,
    });
    expect(sessions.response.status).toBe(403);

    const tokens = await jsonRequest("/api/auth/tokens", {
      cookies: candidateCookies,
    });
    expect(tokens.response.status).toBe(403);
  });

  test("staff can list sessions and revoke another device", async () => {
    const { user } = await signInCookie("admin@hiroapp.com");
    const other = await authManager().signIn(
      {
        id: user.id,
        name: `${user.first_name} ${user.last_name}`,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        role_id: user.role_id,
        is_admin: true,
      },
      { userAgent: "OtherDevice/1.0", ipAddress: "203.0.113.9" },
    );

    const listed = await jsonRequest("/api/users/me/sessions", { cookies: adminCookies });
    expect(listed.response.status).toBe(200);
    expect(listed.body.length).toBeGreaterThan(1);
    const otherRow = listed.body.find(
      (row: { current: boolean; user_agent: string }) => row.user_agent === "OtherDevice/1.0",
    );
    expect(otherRow).toBeTruthy();

    const revoked = await jsonRequest(`/api/users/me/sessions/${other.sessionId}`, {
      cookies: adminCookies,
      method: "DELETE",
    });
    expect(revoked.response.status).toBe(200);

    const after = await jsonRequest("/api/users/me/sessions", { cookies: adminCookies });
    expect(
      after.body.some((row: { user_agent: string }) => row.user_agent === "OtherDevice/1.0"),
    ).toBe(false);
  });

  test("staff can create and revoke an API token", async () => {
    const created = await jsonRequest("/api/auth/tokens", {
      cookies: recruiterCookies,
      method: "POST",
      body: JSON.stringify({ name: "ci-token" }),
    });
    expect(created.response.status).toBe(201);
    expect(typeof created.body.plainTextToken).toBe("string");
    expect(created.body.token.name).toBe("ci-token");

    const listed = await jsonRequest("/api/auth/tokens", { cookies: recruiterCookies });
    expect(listed.body.some((row: { name: string }) => row.name === "ci-token")).toBe(true);

    const revoked = await jsonRequest(`/api/auth/tokens/${created.body.token.id}`, {
      cookies: recruiterCookies,
      method: "DELETE",
    });
    expect(revoked.response.status).toBe(200);
  });

  test("staff MFA setup, confirm, and login challenge", async () => {
    const begin = await jsonRequest("/api/users/me/mfa", {
      cookies: recruiterCookies,
      method: "POST",
    });
    expect(begin.response.status).toBe(200);
    expect(begin.body.secret).toBeTruthy();
    const code = generateTotp(begin.body.secret, Math.floor(Date.now() / 30_000));
    const confirm = await jsonRequest("/api/users/me/mfa/confirm", {
      cookies: recruiterCookies,
      method: "POST",
      body: JSON.stringify({ mfa_code: code }),
    });
    expect(confirm.response.status).toBe(200);
    expect(confirm.body.mfa_enabled).toBe(true);
    expect(confirm.body.recovery_codes.length).toBeGreaterThan(0);

    const login = await guestJson("/api/login", {
      method: "POST",
      body: JSON.stringify({ email: "recruiter@hiroapp.com", password: "password" }),
    });
    expect(login.response.status).toBe(423);
    expect(login.body.mfa_required).toBe(true);

    const challengeCode = generateTotp(begin.body.secret, Math.floor(Date.now() / 30_000));
    const challenged = await guestJson("/api/auth/two-factor-challenge", {
      cookies: login.cookies,
      method: "POST",
      body: JSON.stringify({ mfa_code: challengeCode }),
    });
    expect(challenged.response.status).toBe(200);
    expect(challenged.body.email).toBe("recruiter@hiroapp.com");

    await jsonRequest("/api/users/me/mfa", {
      cookies: recruiterCookies,
      method: "DELETE",
      body: JSON.stringify({ password: "password" }),
    });
  });

  test("HTML account page is staff-aware", async () => {
    const staff = await request("/account", { cookies: adminCookies });
    expect(staff.response.status).toBe(200);
    expect(staff.text).toContain("Two-factor authentication");
    expect(staff.text).toContain("<h2>API tokens</h2>");

    const candidate = await request("/account", { cookies: candidateCookies });
    expect(candidate.response.status).toBe(200);
    expect(candidate.text).toContain("Profile");
    expect(candidate.text).not.toContain("<h2>API tokens</h2>");
    expect(candidate.text).not.toContain("Two-factor authentication");
  });

  test("logout other devices keeps the current cookie session", async () => {
    const { user } = await signInCookie("admin@hiroapp.com");
    await authManager().signIn(
      {
        id: user.id,
        name: "Admin Hiro",
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        role_id: user.role_id,
        is_admin: true,
      },
      { userAgent: "SpareDevice/1.0" },
    );
    const result = await jsonRequest("/api/users/me/logout-other-devices", {
      cookies: adminCookies,
      method: "POST",
      body: JSON.stringify({ password: "password" }),
    });
    expect(result.response.status).toBe(200);
    const listed = await jsonRequest("/api/users/me/sessions", { cookies: adminCookies });
    expect(listed.body.every((row: { current: boolean }) => row.current)).toBe(true);
    const stillMe = await jsonRequest("/api/users/me", { cookies: adminCookies });
    expect(stillMe.response.status).toBe(200);
  });
});

void users;
