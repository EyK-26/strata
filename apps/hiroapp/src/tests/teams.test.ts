import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { hashPassword } from "@getstrata/core/auth/password";
import { ROLE } from "../lib/roles.ts";
import { departments } from "../modules/departments/repository.ts";
import { users } from "../modules/users/repository.ts";
import { bootHiroapp, collectCookies, cookieHeader, csrfFrom, signInCookie } from "./helpers.ts";

const enabled = process.env.HIROAPP_TEST === "1";

describe.skipIf(!enabled)("Wave 7 hiring teams", () => {
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

  test("recruiter membership replaces occupied-position as current team", async () => {
    const listed = await jsonRequest("/api/users/me/departments", { cookies: recruiterCookies });
    expect(listed.response.status).toBe(200);
    expect(listed.body.current_department_id).toBeTruthy();
    expect(listed.body.memberships.length).toBeGreaterThan(0);

    const members = await jsonRequest(
      `/api/departments/${listed.body.current_department_id}/members`,
      { cookies: recruiterCookies },
    );
    expect(members.response.status).toBe(200);
    expect(
      members.body.some(
        (row: { user?: { email: string } }) => row.user?.email === "recruiter@hiroapp.com",
      ),
    ).toBe(true);
  });

  test("candidates cannot join or inspect hiring teams", async () => {
    const listed = await jsonRequest("/api/users/me/departments", { cookies: candidateCookies });
    expect(listed.response.status).toBe(403);
    const depts = await departments.ordered();
    const members = await jsonRequest(`/api/departments/${depts[0]!.id}/members`, {
      cookies: candidateCookies,
    });
    expect(members.response.status).toBe(403);
    const invited = await jsonRequest(`/api/departments/${depts[0]!.id}/invitations`, {
      cookies: adminCookies,
      method: "POST",
      body: JSON.stringify({ email: "candidate@hiroapp.com" }),
    });
    expect(invited.response.status).toBe(422);
  });

  test("admin can invite staff and the invitee can accept", async () => {
    const depts = await departments.ordered();
    const invited = await users.create({
      first_name: "Invitee",
      last_name: "Staff",
      email: `invitee.${Date.now()}@hiroapp.com`,
      password: await hashPassword("password"),
      role_id: ROLE.RECRUITER,
    });
    const created = await jsonRequest(`/api/departments/${depts[0]!.id}/invitations`, {
      cookies: adminCookies,
      method: "POST",
      body: JSON.stringify({ email: invited.email, role: "member" }),
    });
    expect(created.response.status).toBe(201);
    expect(created.body.invitation.email).toBe(invited.email);

    const inviteeCookies = (await signInCookie(invited.email)).cookies;
    const pending = await jsonRequest("/api/users/me/invitations", { cookies: inviteeCookies });
    expect(pending.body.length).toBeGreaterThan(0);
    const accepted = await jsonRequest(
      `/api/users/me/invitations/${created.body.invitation.id}/accept`,
      { cookies: inviteeCookies, method: "POST" },
    );
    expect(accepted.response.status).toBe(200);
    const teams = await jsonRequest("/api/users/me/departments", { cookies: inviteeCookies });
    expect(teams.body.current_department_id).toBe(Number(depts[0]!.id));
  });

  test("admin can switch current department", async () => {
    const depts = await departments.ordered();
    expect(depts.length).toBeGreaterThan(1);
    const switched = await jsonRequest("/api/users/me/current-department", {
      cookies: adminCookies,
      method: "PUT",
      body: JSON.stringify({ department_id: depts[1]!.id }),
    });
    expect(switched.response.status).toBe(200);
    expect(Number(switched.body.current_department_id)).toBe(Number(depts[1]!.id));
  });

  test("recruiter cannot manage another department team", async () => {
    const depts = await departments.ordered();
    const listed = await jsonRequest("/api/users/me/departments", { cookies: recruiterCookies });
    const other = depts.find((row) => Number(row.id) !== Number(listed.body.current_department_id));
    expect(other).toBeTruthy();
    const members = await jsonRequest(`/api/departments/${other!.id}/members`, {
      cookies: recruiterCookies,
    });
    expect(members.response.status).toBe(403);
  });

  test("HTML account page shows hiring team for staff", async () => {
    const page = await request("/account", { cookies: recruiterCookies });
    expect(page.response.status).toBe(200);
    expect(page.text).toContain("Hiring team");
  });
});
