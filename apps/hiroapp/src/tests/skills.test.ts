import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { hashPassword } from "@getstrata/core/auth/password";
import { ForbiddenError } from "@getstrata/core/errors/http";
import { ROLE } from "../lib/roles.ts";
import { Position } from "../models/Position.ts";
import { User } from "../models/User.ts";
import { skills } from "../modules/skills/repository.ts";
import { parseSkillIds, skillService } from "../modules/skills/service.ts";
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

describe.skipIf(!enabled)("Wave 18 skill match", () => {
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

  test("parseSkillIds drops blanks and non-positive values", () => {
    expect(parseSkillIds(null)).toEqual([]);
    expect(parseSkillIds("")).toEqual([]);
    expect(parseSkillIds("1, 2, 0, -3, x, 2")).toEqual([1, 2, 2]);
  });

  test("sync skills, rank candidates, and refuse candidate position edits", async () => {
    const catalog = await skills.ordered();
    const typescript = catalog.find((row) => row.name === "TypeScript");
    const react = catalog.find((row) => row.name === "React");
    const postgres = catalog.find((row) => row.name === "PostgreSQL");
    if (!typescript || !react || !postgres) {
      throw new Error("Missing seeded skills");
    }

    const candidate = await seededUser("candidate@hiroapp.com");
    const recruiter = await seededUser("recruiter@hiroapp.com");
    const seat = await Position.create({
      user_id: null,
      department_id: 1,
      grade_id: 1,
      name: `Match ${Date.now()}`,
      description: null,
      hiring: true,
      start_date: null,
      end_date: null,
    });

    const emptyRequired = await skillService.matchCandidates(seat);
    expect(emptyRequired.every((row) => row.required === 0 && row.matched === 0)).toBe(true);

    await expect(
      skillService.replacePositionSkills(candidate, seat, [{ skill_id: typescript.id }]),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await skillService.replacePositionSkills(recruiter, seat, [
      { skill_id: 0 },
      { skill_id: typescript.id, required: true, weight: 3 },
      { skill_id: typescript.id, required: true, weight: 9 },
      { skill_id: postgres.id, required: false },
    ]);
    const attached = await seat.skills();
    expect(attached.map((row) => Number(row.id)).sort((left, right) => left - right)).toEqual(
      [Number(typescript.id), Number(postgres.id)].sort((left, right) => left - right),
    );

    const matcher = await users.create({
      first_name: "Full",
      last_name: "Match",
      email: `full.match.${Date.now()}@hiroapp.com`,
      password: await hashPassword("password"),
      role_id: ROLE.CANDIDATE,
    });
    await skillService.replaceUserSkills(matcher, [
      { skill_id: Number.NaN },
      { skill_id: typescript.id, years: 4, level: "advanced" },
      { skill_id: typescript.id, years: 1 },
      { skill_id: react.id },
    ]);
    const owned = await User.newFromRecord(matcher).skills();
    expect(owned.some((row) => Number(row.id) === Number(typescript.id))).toBe(true);
    expect(owned.some((row) => Number(row.id) === Number(react.id))).toBe(true);

    const other = await users.create({
      first_name: "Zero",
      last_name: "Match",
      email: `zero.match.${Date.now()}@hiroapp.com`,
      password: await hashPassword("password"),
      role_id: ROLE.CANDIDATE,
    });
    await skillService.replaceUserSkills(other, []);

    const ranked = await skillService.matchCandidates(seat);
    const self = ranked.find((row) => Number(row.user.id) === matcher.id);
    const blank = ranked.find((row) => Number(row.user.id) === other.id);
    if (!self || !blank) {
      throw new Error("Expected extra candidates in skill match");
    }
    expect(self.matched).toBe(1);
    expect(self.required).toBe(2);
    expect(blank.matched).toBe(0);
    expect(ranked[0]?.matched ?? 0).toBeGreaterThanOrEqual(ranked[1]?.matched ?? 0);
    expect(skillService.presentMatch(self).first_name).toBe(matcher.first_name);
    expect(skillService.presentMatchApi(self).user.id).toBe(matcher.id);

    const api = await jsonRequest(`/api/positions/${seat.id}/match`, {
      cookies: recruiterCookies,
    });
    expect(api.response.status).toBe(200);
    expect(api.body.some((row: { matched: number }) => row.matched >= 1)).toBe(true);

    const synced = await jsonRequest(`/api/positions/${seat.id}/skills`, {
      cookies: recruiterCookies,
      method: "POST",
      body: JSON.stringify({
        skills: [{ skill_id: react.id, required: true, weight: 2 }],
      }),
    });
    expect(synced.response.status).toBe(200);

    const listed = await jsonRequest("/api/me/skills", { cookies: candidateCookies });
    expect(listed.response.status).toBe(200);

    const page = await request(`/positions/${seat.id}/match`, { cookies: recruiterCookies });
    expect(page.response.status).toBe(200);
    expect(page.text).toContain("Zero");
  });
});
