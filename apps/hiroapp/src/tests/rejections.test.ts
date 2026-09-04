import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { ForbiddenError, UnprocessableEntityError } from "@getstrata/core/errors/http";
import { STATUS } from "../lib/roles.ts";
import { Application } from "../models/Application.ts";
import { ApplicationRejection } from "../models/ApplicationRejection.ts";
import { Position } from "../models/Position.ts";
import { rejectionReasons } from "../modules/rejections/repository.ts";
import { rejectionService, serializeRejection } from "../modules/rejections/service.ts";
import {
  bootHiroapp,
  collectCookies,
  cookieHeader,
  csrfFrom,
  seededUser,
  signInCookie,
} from "./helpers.ts";

const enabled = process.env.HIROAPP_TEST === "1";

describe.skipIf(!enabled)("Wave 26 application rejections", () => {
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
      name: `Reject Seat ${Date.now()}-${Math.random()}`,
      description: "reject",
      hiring: true,
      start_date: null,
      end_date: null,
    });
    return Application.create({
      user_id: userId,
      position_id: Number(seat.id),
      status_id: STATUS.FEEDBACK,
      attachment_text: null,
      attachment_file: null,
    });
  }

  test("staff reject with a catalog reason; candidates cannot", async () => {
    const candidate = await seededUser("candidate@hiroapp.com");
    const recruiter = await seededUser("recruiter@hiroapp.com");
    const reasons = await rejectionReasons.ordered();
    const skills = reasons.find((row) => row.name === "skills");
    if (!skills) {
      throw new Error("missing skills rejection reason");
    }

    const application = await openApplication(candidate.id);
    expect(await rejectionService.forApplication(recruiter, application)).toEqual([]);
    await expect(rejectionService.listReasons(candidate)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(rejectionService.forApplication(candidate, application)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      rejectionService.reject(candidate, application, { reason_id: skills.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      rejectionService.reject(recruiter, application, { reason_id: 9_999_999 }),
    ).rejects.toBeInstanceOf(UnprocessableEntityError);

    const created = await rejectionService.reject(recruiter, application, {
      reason_id: skills.id,
      notes: "  ",
    });
    expect(created.reason_id).toBe(skills.id);
    expect(created.notes).toBeNull();
    expect(Number((await Application.findOrFail(application.id)).get("status_id"))).toBe(
      STATUS.ENDED,
    );
    expect(serializeRejection(created).application_id).toBe(Number(application.id));
    const model = await ApplicationRejection.findOrFail(created.id);
    expect(serializeRejection(model).reason_id).toBe(skills.id);
    expect((await application.rejections()).length).toBe(1);

    await expect(
      rejectionService.reject(recruiter, await Application.findOrFail(application.id), {
        reason_id: skills.id,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const noted = await openApplication(candidate.id);
    const recorded = await rejectionService.reject(recruiter, noted, {
      reason_id: skills.id,
      notes: "not a match",
    });
    expect(recorded.notes).toBe("not a match");

    const forbiddenReasons = await jsonRequest("/api/rejection-reasons", {
      cookies: candidateCookies,
    });
    expect(forbiddenReasons.response.status).toBe(403);

    const listed = await jsonRequest("/api/rejection-reasons", { cookies: recruiterCookies });
    expect(listed.response.status).toBe(200);
    expect(listed.body.some((row: { name: string }) => row.name === "culture")).toBe(true);

    const httpApp = await openApplication(candidate.id);
    const empty = await jsonRequest(`/api/applications/${httpApp.id}/rejections`, {
      cookies: recruiterCookies,
    });
    expect(empty.body).toEqual([]);
    const rejected = await jsonRequest(`/api/applications/${httpApp.id}/reject`, {
      cookies: recruiterCookies,
      method: "POST",
      body: JSON.stringify({ reason_id: skills.id, notes: "http" }),
    });
    expect(rejected.response.status).toBe(200);
    expect(rejected.body.reason_id).toBe(skills.id);
    const listedHttp = await jsonRequest(`/api/applications/${httpApp.id}/rejections`, {
      cookies: recruiterCookies,
    });
    expect(listedHttp.body.length).toBe(1);

    const htmlApp = await openApplication(candidate.id);
    const primed = await request(`/applications/${htmlApp.id}`, { cookies: recruiterCookies });
    const html = await request(`/applications/${htmlApp.id}/reject`, {
      cookies: primed.cookies,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-csrf-token": csrfFrom(primed.cookies),
      },
      body: `reason_id=${skills.id}&notes=html`,
    });
    expect([302, 303].includes(html.response.status)).toBe(true);
  });
});
