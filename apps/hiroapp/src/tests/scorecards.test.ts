import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { ForbiddenError, UnprocessableEntityError } from "@getstrata/core/errors/http";
import { STATUS } from "../lib/roles.ts";
import { Application } from "../models/Application.ts";
import { Interview } from "../models/Interview.ts";
import { Position } from "../models/Position.ts";
import { interviewService } from "../modules/interviews/service.ts";
import { scorecardService, serializeScorecard } from "../modules/scorecards/service.ts";
import {
  bootHiroapp,
  collectCookies,
  cookieHeader,
  csrfFrom,
  seededUser,
  signInCookie,
} from "./helpers.ts";

const enabled = process.env.HIROAPP_TEST === "1";

describe.skipIf(!enabled)("Wave 24 interview scorecards", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl = "";
  let recruiterCookies: string[] = [];
  let candidateCookies: string[] = [];
  let adminCookies: string[] = [];

  beforeAll(async () => {
    const boot = await bootHiroapp();
    server = boot.server;
    baseUrl = boot.baseUrl;
    recruiterCookies = (await signInCookie("recruiter@hiroapp.com")).cookies;
    candidateCookies = (await signInCookie("candidate@hiroapp.com")).cookies;
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

  test("staff submit and update scorecards; candidates cannot", async () => {
    const candidate = await seededUser("candidate@hiroapp.com");
    const recruiter = await seededUser("recruiter@hiroapp.com");
    const admin = await seededUser("admin@hiroapp.com");
    const seat = await Position.create({
      user_id: null,
      department_id: 1,
      grade_id: 1,
      name: `Scorecard Seat ${Date.now()}`,
      description: "panel",
      hiring: true,
      start_date: null,
      end_date: null,
    });
    const application = await Application.create({
      user_id: candidate.id,
      position_id: Number(seat.id),
      status_id: STATUS.INTERVIEW,
      attachment_text: null,
      attachment_file: null,
    });
    const created = await interviewService.schedule(recruiter, {
      application_id: Number(application.id),
      scheduled_at: "2026-09-11T10:00",
    });
    const interview = await Interview.findOrFail(created.interview.id);

    const empty = await scorecardService.listForInterview(recruiter, interview);
    expect(empty.data).toEqual([]);
    expect(empty.summary).toEqual({
      count: 0,
      average: null,
      hire: 0,
      no_hire: 0,
      hold: 0,
    });

    await expect(scorecardService.listForInterview(candidate, interview)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      scorecardService.submit(candidate, interview, { overall_score: 5, recommendation: "hire" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      scorecardService.submit(recruiter, interview, { overall_score: 0, recommendation: "hire" }),
    ).rejects.toBeInstanceOf(UnprocessableEntityError);
    await expect(
      scorecardService.submit(recruiter, interview, {
        overall_score: 3,
        recommendation: "maybe",
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityError);

    const first = await scorecardService.submit(recruiter, interview, {
      overall_score: 5,
      recommendation: "hire",
      notes: "  ",
    });
    expect(first.overall_score).toBe(5);
    expect(first.recommendation).toBe("hire");
    expect(first.notes).toBeNull();
    expect(serializeScorecard(first).interview_id).toBe(Number(interview.id));

    const updated = await scorecardService.submit(recruiter, interview, {
      overall_score: 3,
      recommendation: "hold",
      notes: "  panel  ",
    });
    expect(updated.id).toBe(first.id);
    expect(updated.overall_score).toBe(3);
    expect(updated.recommendation).toBe("hold");
    expect(updated.notes).toBe("panel");

    const second = await scorecardService.submit(admin, interview, {
      overall_score: 1,
      recommendation: "no_hire",
    });
    expect(second.recommendation).toBe("no_hire");

    const listed = await scorecardService.listForInterview(recruiter, interview);
    expect(listed.summary.count).toBe(2);
    expect(listed.summary.hold).toBe(1);
    expect(listed.summary.no_hire).toBe(1);
    expect(listed.summary.average).toBe(2);

    const forbidden = await jsonRequest(`/api/interviews/${interview.id}/scorecards`, {
      cookies: candidateCookies,
    });
    expect(forbidden.response.status).toBe(403);

    const http = await jsonRequest(`/api/interviews/${interview.id}/scorecards`, {
      cookies: recruiterCookies,
      method: "POST",
      body: JSON.stringify({ overall_score: 4, recommendation: "hire", notes: "api" }),
    });
    expect(http.response.status).toBe(200);
    expect(http.body.overall_score).toBe(4);

    const httpList = await jsonRequest(`/api/interviews/${interview.id}/scorecards`, {
      cookies: recruiterCookies,
    });
    expect(httpList.body.summary.count).toBe(2);

    const primed = await request("/interviews", { cookies: adminCookies });
    const html = await request(`/interviews/${interview.id}/scorecards`, {
      cookies: primed.cookies,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-csrf-token": csrfFrom(primed.cookies),
      },
      body: "overall_score=2&recommendation=hold&notes=html",
    });
    expect([302, 303].includes(html.response.status)).toBe(true);
  });
});
