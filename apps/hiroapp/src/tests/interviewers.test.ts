import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { hashPassword } from "@getstrata/core/auth/password";
import { ForbiddenError, UnprocessableEntityError } from "@getstrata/core/errors/http";
import { ROLE } from "../lib/roles.ts";
import { Position } from "../models/Position.ts";
import { interviewerService } from "../modules/positions/interviewers.ts";
import { users } from "../modules/users/repository.ts";
import {
  bootHiroapp,
  collectCookies,
  cookieHeader,
  csrfFrom,
  seededUser,
  signInCookie,
} from "./helpers.ts";

const enabled = process.env.HIROAPP_TEST === "1";

describe.skipIf(!enabled)("Wave 16 interviewer panel", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl = "";
  let recruiterCookies: string[] = [];
  let candidateCookies: string[] = [];

  beforeAll(async () => {
    const boot = await bootHiroapp();
    server = boot.server;
    baseUrl = boot.baseUrl;
    recruiterCookies = (await signInCookie("recruiter@hiroapp.com")).cookies;
    candidateCookies = (await signInCookie("candidate@hiroapp.com")).cookies;
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

  test("staff sync interviewers, reject candidates, and clear the panel", async () => {
    const candidate = await seededUser("candidate@hiroapp.com");
    const recruiter = await seededUser("recruiter@hiroapp.com");
    const admin = await seededUser("admin@hiroapp.com");
    const seat = await Position.create({
      user_id: null,
      department_id: 1,
      grade_id: 1,
      name: `Panel ${Date.now()}`,
      description: null,
      hiring: true,
      start_date: null,
      end_date: null,
    });

    expect(await interviewerService.list(seat)).toEqual([]);
    await expect(
      interviewerService.sync(candidate, seat, { user_ids: [recruiter.id] }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      interviewerService.sync(recruiter, seat, { user_ids: [candidate.id] }),
    ).rejects.toBeInstanceOf(UnprocessableEntityError);
    await expect(
      interviewerService.sync(recruiter, seat, { user_ids: [9_999_999] }),
    ).rejects.toBeInstanceOf(UnprocessableEntityError);

    const assigned = await interviewerService.sync(admin, seat, {
      user_ids: [recruiter.id, recruiter.id, 0, admin.id],
      role: "  ",
    });
    expect(assigned.length).toBe(2);

    const extra = await users.create({
      first_name: "Panel",
      last_name: "Recruiter",
      email: `panel.interviewers.${Date.now()}@hiroapp.com`,
      password: await hashPassword("password"),
      role_id: ROLE.RECRUITER,
    });
    const named = await interviewerService.sync(recruiter, seat, {
      user_ids: [extra.id],
      role: "lead",
    });
    expect(named.length).toBe(1);
    expect(Number(named[0]?.id)).toBe(extra.id);

    const cleared = await interviewerService.sync(admin, seat, { user_ids: [] });
    expect(cleared).toEqual([]);

    const http = await jsonRequest(`/api/positions/${seat.id}/interviewers`, {
      cookies: recruiterCookies,
      method: "POST",
      body: JSON.stringify({ user_ids: [recruiter.id], role: "panel" }),
    });
    expect(http.response.status).toBe(200);
    expect(http.body.length).toBe(1);

    const listed = await jsonRequest(`/api/positions/${seat.id}/interviewers`, {
      cookies: candidateCookies,
    });
    expect(listed.response.status).toBe(200);

    const forbidden = await jsonRequest(`/api/positions/${seat.id}/interviewers`, {
      cookies: candidateCookies,
      method: "POST",
      body: JSON.stringify({ user_ids: [recruiter.id] }),
    });
    expect(forbidden.response.status).toBe(403);

    const primed = await request(`/positions/${seat.id}`, { cookies: recruiterCookies });
    expect(primed.text).toContain("Assign interviewers");
    const html = await request(`/positions/${seat.id}/interviewers`, {
      cookies: primed.cookies,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-csrf-token": csrfFrom(primed.cookies),
      },
      body: `user_ids=${admin.id}`,
    });
    expect([302, 303].includes(html.response.status)).toBe(true);
  });
});
