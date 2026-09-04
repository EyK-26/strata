import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { hashPassword } from "@getstrata/core/auth/password";
import { ROLE } from "../lib/roles.ts";
import { departments } from "../modules/departments/repository.ts";
import { users } from "../modules/users/repository.ts";
import { bootHiroapp, collectCookies, cookieHeader, csrfFrom, signInCookie } from "./helpers.ts";

const enabled = process.env.HIROAPP_TEST === "1";

describe.skipIf(!enabled)("Wave 8 tenant RLS", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl = "";
  let recruiterCookies: string[] = [];
  let adminCookies: string[] = [];
  let isolatedDepartmentId = 0;
  let isolatedUserId = 0;

  let isolatedUserEmail = "";

  beforeAll(async () => {
    const boot = await bootHiroapp();
    server = boot.server;
    baseUrl = boot.baseUrl;
    recruiterCookies = (await signInCookie("recruiter@hiroapp.com")).cookies;
    adminCookies = (await signInCookie("admin@hiroapp.com")).cookies;

    isolatedUserEmail = `isolated.${Date.now()}@hiroapp.com`;
    const isolatedUser = await users.create({
      first_name: "Isolated",
      last_name: "Recruiter",
      email: isolatedUserEmail,
      password: await hashPassword("password"),
      role_id: ROLE.RECRUITER,
      tenant_id: 2,
    });
    isolatedUserId = Number(isolatedUser.id);
    const isolatedDepartment = await departments.create({
      name: `Isolated Hiring ${Date.now()}`,
      tenant_id: 2,
    });
    isolatedDepartmentId = Number(isolatedDepartment.id);
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

  test("staff requests are scoped to the default tenant", async () => {
    const listed = await jsonRequest("/api/departments", { cookies: recruiterCookies });
    expect(listed.response.status).toBe(200);
    expect(listed.response.headers.get("x-tenant-id")).toBe("1");
    expect(listed.body.some((row: { id: number }) => Number(row.id) === isolatedDepartmentId)).toBe(
      false,
    );

    const people = await jsonRequest("/api/users", { cookies: adminCookies });
    expect(people.response.status).toBe(200);
    expect(people.body.some((row: { id: number }) => Number(row.id) === isolatedUserId)).toBe(
      false,
    );
  });

  test("recruiter cannot spoof x-tenant-id", async () => {
    const listed = await jsonRequest("/api/departments", {
      cookies: recruiterCookies,
      headers: { "x-tenant-id": "2" },
    });
    expect(listed.response.status).toBe(403);
  });

  test("admin can switch tenant with x-tenant-id and see isolated hiring data", async () => {
    const listed = await jsonRequest("/api/departments", {
      cookies: adminCookies,
      headers: { "x-tenant-id": "2" },
    });
    expect(listed.response.status).toBe(200);
    expect(listed.response.headers.get("x-tenant-id")).toBe("2");
    expect(listed.body.some((row: { id: number }) => Number(row.id) === isolatedDepartmentId)).toBe(
      true,
    );
    expect(
      listed.body.some((row: { name: string }) => String(row.name).startsWith("Department of ")),
    ).toBe(false);

    const people = await jsonRequest("/api/users", {
      cookies: adminCookies,
      headers: { "x-tenant-id": "2" },
    });
    expect(people.response.status).toBe(200);
    expect(people.body.some((row: { id: number }) => Number(row.id) === isolatedUserId)).toBe(true);
  });

  test("isolated tenant staff can sign in by email", async () => {
    const primed = await request("/login");
    const token = csrfFrom(primed.cookies);
    const login = await request("/api/login", {
      method: "POST",
      cookies: primed.cookies,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-csrf-token": token,
      },
      body: JSON.stringify({
        email: isolatedUserEmail,
        password: "password",
      }),
    });
    expect(login.response.status).toBe(200);

    const listed = await jsonRequest("/api/departments", { cookies: login.cookies });
    expect(listed.response.status).toBe(200);
    expect(listed.response.headers.get("x-tenant-id")).toBe("2");
    expect(listed.body.some((row: { id: number }) => Number(row.id) === isolatedDepartmentId)).toBe(
      true,
    );
    expect(
      listed.body.some((row: { name: string }) => String(row.name).startsWith("Department of ")),
    ).toBe(false);
  });
});
