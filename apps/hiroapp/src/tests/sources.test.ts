import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { hashPassword } from "@getstrata/core/auth/password";
import { ForbiddenError, UnprocessableEntityError } from "@getstrata/core/errors/http";
import { ROLE, STATUS } from "../lib/roles.ts";
import { Application } from "../models/Application.ts";
import { Position } from "../models/Position.ts";
import { applicationService } from "../modules/applications/service.ts";
import { applicationSources } from "../modules/sources/repository.ts";
import { sourceService } from "../modules/sources/service.ts";
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

describe.skipIf(!enabled)("Wave 29 application sources", () => {
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

  async function openApplication(userId: number) {
    const seat = await Position.create({
      user_id: null,
      department_id: 1,
      grade_id: 1,
      name: `Source Seat ${Date.now()}-${Math.random()}`,
      description: "source",
      hiring: true,
      start_date: null,
      end_date: null,
    });
    return Application.create({
      user_id: userId,
      position_id: Number(seat.id),
      status_id: STATUS.APPLIED,
      attachment_text: null,
      attachment_file: null,
    });
  }

  test("staff and the applicant can record a catalog source", async () => {
    const candidate = await seededUser("candidate@hiroapp.com");
    const recruiter = await seededUser("recruiter@hiroapp.com");
    const other = await users.create({
      first_name: "Other",
      last_name: "Source",
      email: `other.source.${Date.now()}@hiroapp.com`,
      password: await hashPassword("password"),
      role_id: ROLE.CANDIDATE,
    });
    const sources = await applicationSources.ordered();
    const linkedin = sources.find((row) => row.name === "linkedin");
    const referral = sources.find((row) => row.name === "referral");
    if (!linkedin || !referral) {
      throw new Error("missing application sources");
    }

    expect((await sourceService.list()).some((row) => row.name === "agency")).toBe(true);
    const application = await openApplication(candidate.id);
    expect(await sourceService.forApplication(recruiter, application)).toBeNull();
    await expect(sourceService.forApplication(other, application)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      sourceService.record(other, application, { source_id: linkedin.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      sourceService.record(recruiter, application, { source_id: 9_999_999 }),
    ).rejects.toBeInstanceOf(UnprocessableEntityError);

    const created = await sourceService.record(candidate, application, {
      source_id: linkedin.id,
      notes: "  ",
    });
    expect(created.source_id).toBe(linkedin.id);
    expect(created.notes).toBeNull();
    const updated = await sourceService.record(recruiter, application, {
      source_id: referral.id,
      notes: "staff correction",
    });
    expect(updated.source_id).toBe(referral.id);
    expect(updated.notes).toBe("staff correction");
    expect((await sourceService.forApplication(candidate, application))?.source_id).toBe(
      referral.id,
    );

    const seat = await Position.create({
      user_id: null,
      department_id: 1,
      grade_id: 1,
      name: `Source Apply ${Date.now()}`,
      description: "apply source",
      hiring: true,
      start_date: null,
      end_date: null,
    });
    await expect(
      applicationService.apply(candidate, {
        position_id: Number(seat.id),
        attachment_text: null,
        attachment_file: null,
        source_id: 9_999_999,
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityError);
    const applied = await applicationService.apply(candidate, {
      position_id: Number(seat.id),
      attachment_text: "cover",
      attachment_file: null,
      source_id: linkedin.id,
    });
    expect(
      (await sourceService.forApplication(recruiter, await Application.findOrFail(applied.id)))
        ?.source_id,
    ).toBe(linkedin.id);

    const listed = await jsonRequest("/api/application-sources", { cookies: candidateCookies });
    expect(listed.response.status).toBe(200);
    expect(listed.body.some((row: { name: string }) => row.name === "other")).toBe(true);

    const httpApp = await openApplication(candidate.id);
    const empty = await jsonRequest(`/api/applications/${httpApp.id}/source`, {
      cookies: recruiterCookies,
    });
    expect(empty.body).toBeNull();
    const posted = await jsonRequest(`/api/applications/${httpApp.id}/source`, {
      cookies: recruiterCookies,
      method: "POST",
      body: JSON.stringify({ source_id: linkedin.id, notes: "http" }),
    });
    expect(posted.response.status).toBe(200);
    expect(posted.body.source_id).toBe(linkedin.id);

    const htmlApp = await openApplication(candidate.id);
    const primed = await request(`/applications/${htmlApp.id}`, { cookies: recruiterCookies });
    const html = await request(`/applications/${htmlApp.id}/source`, {
      cookies: primed.cookies,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-csrf-token": csrfFrom(primed.cookies),
      },
      body: `source_id=${linkedin.id}&notes=html`,
    });
    expect([302, 303].includes(html.response.status)).toBe(true);
  });
});
