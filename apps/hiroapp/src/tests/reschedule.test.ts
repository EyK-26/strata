import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { ForbiddenError, ValidationError } from "@getstrata/core/errors/http";
import { STATUS } from "../lib/roles.ts";
import { Application } from "../models/Application.ts";
import { Interview } from "../models/Interview.ts";
import { Position } from "../models/Position.ts";
import { interviewService } from "../modules/interviews/service.ts";
import {
  bootHiroapp,
  collectCookies,
  cookieHeader,
  csrfFrom,
  seededUser,
  signInCookie,
} from "./helpers.ts";

const enabled = process.env.HIROAPP_TEST === "1";

describe.skipIf(!enabled)("Wave 28 interview reschedule", () => {
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

  test("staff reschedule scheduled or confirmed interviews", async () => {
    const candidate = await seededUser("candidate@hiroapp.com");
    const recruiter = await seededUser("recruiter@hiroapp.com");
    const seat = await Position.create({
      user_id: null,
      department_id: 1,
      grade_id: 1,
      name: `Reschedule Seat ${Date.now()}`,
      description: "reschedule",
      hiring: true,
      start_date: null,
      end_date: null,
    });
    const application = await Application.create({
      user_id: candidate.id,
      position_id: Number(seat.id),
      status_id: STATUS.IN_PROGRESS,
      attachment_text: null,
      attachment_file: null,
    });

    const created = await interviewService.schedule(recruiter, {
      application_id: Number(application.id),
      scheduled_at: "2026-09-20T10:00",
      place: "Room A",
    });
    const interview = await Interview.findOrFail(created.interview.id);

    await expect(
      interviewService.reschedule(candidate, interview, { scheduled_at: "2026-09-21T11:00" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      interviewService.reschedule(recruiter, interview, { scheduled_at: "not-a-date" }),
    ).rejects.toBeInstanceOf(ValidationError);

    const keptPlace = await interviewService.reschedule(recruiter, interview, {
      scheduled_at: "2026-09-21T11:00",
    });
    expect(keptPlace.place).toBe("Room A");
    expect(new Date(keptPlace.scheduled_at).toISOString()).toContain("2026-09-21");

    const moved = await interviewService.reschedule(
      recruiter,
      await Interview.findOrFail(interview.id),
      {
        scheduled_at: "2026-09-22T09:00",
        place: "Room B",
        text: "Please join the new room",
      },
    );
    expect(moved.place).toBe("Room B");

    const cleared = await interviewService.reschedule(
      recruiter,
      await Interview.findOrFail(interview.id),
      { scheduled_at: "2026-09-22T10:00", place: "  " },
    );
    expect(cleared.place).toBeNull();

    const confirmed = await interviewService.confirm(
      candidate,
      await Interview.findOrFail(interview.id),
    );
    expect(confirmed.status).toBe("confirmed");
    const stillOpen = await interviewService.reschedule(
      recruiter,
      await Interview.findOrFail(interview.id),
      { scheduled_at: "2026-09-23T10:00", place: null, text: "" },
    );
    expect(stillOpen.status).toBe("confirmed");
    expect(stillOpen.place).toBeNull();

    await interviewService.complete(recruiter, await Interview.findOrFail(interview.id));
    await expect(
      interviewService.reschedule(recruiter, await Interview.findOrFail(interview.id), {
        scheduled_at: "2026-09-24T10:00",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const toCancel = await interviewService.schedule(recruiter, {
      application_id: Number(application.id),
      scheduled_at: "2026-09-25T10:00",
    });
    await interviewService.cancel(recruiter, await Interview.findOrFail(toCancel.interview.id));
    await expect(
      interviewService.reschedule(recruiter, await Interview.findOrFail(toCancel.interview.id), {
        scheduled_at: "2026-09-26T10:00",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const httpTarget = await interviewService.schedule(recruiter, {
      application_id: Number(application.id),
      scheduled_at: "2026-09-27T10:00",
      place: "Zoom",
    });
    const forbiddenHttp = await jsonRequest(
      `/api/interviews/${httpTarget.interview.id}/reschedule`,
      {
        cookies: candidateCookies,
        method: "POST",
        body: JSON.stringify({ scheduled_at: "2026-09-28T10:00" }),
      },
    );
    expect(forbiddenHttp.response.status).toBe(403);
    const ok = await jsonRequest(`/api/interviews/${httpTarget.interview.id}/reschedule`, {
      cookies: recruiterCookies,
      method: "POST",
      body: JSON.stringify({ scheduled_at: "2026-09-28T11:00", place: "Office" }),
    });
    expect(ok.response.status).toBe(200);
    expect(ok.body.place).toBe("Office");

    const htmlTarget = await interviewService.schedule(recruiter, {
      application_id: Number(application.id),
      scheduled_at: "2026-09-29T10:00",
    });
    const primed = await request("/interviews", { cookies: recruiterCookies });
    const html = await request(`/interviews/${htmlTarget.interview.id}/reschedule`, {
      cookies: primed.cookies,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-csrf-token": csrfFrom(primed.cookies),
      },
      body: "scheduled_at=2026-09-30T12%3A00&place=Lobby&text=Moved",
    });
    expect([302, 303].includes(html.response.status)).toBe(true);
  });
});
