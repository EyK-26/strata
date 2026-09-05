import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  getNamedConnection,
  registerNamedConnection,
  unregisterNamedConnection,
} from "@getstrata/core/database/namedConnections";
import { ForbiddenError, UnprocessableEntityError } from "@getstrata/core/errors/http";
import { STATUS } from "../lib/roles.ts";
import { Application } from "../models/Application.ts";
import { Interview } from "../models/Interview.ts";
import { Position } from "../models/Position.ts";
import { interviewService } from "../modules/interviews/service.ts";
import { kioskService } from "../modules/kiosk/service.ts";
import {
  bootHiroapp,
  collectCookies,
  cookieHeader,
  csrfFrom,
  seededUser,
  signInCookie,
} from "./helpers.ts";

const enabled = process.env.HIROAPP_TEST === "1";

describe.skipIf(!enabled)("interview kiosk sqlite sidecar", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl = "";

  beforeAll(async () => {
    const boot = await bootHiroapp();
    server = boot.server;
    baseUrl = boot.baseUrl;
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

  test("staff store scorecards locally and sync them into Postgres", async () => {
    const recruiter = await seededUser("recruiter@hiroapp.com");
    const candidate = await seededUser("candidate@hiroapp.com");
    const seat = await Position.create({
      user_id: null,
      department_id: 1,
      grade_id: 1,
      name: `Kiosk Seat ${Date.now()}`,
      description: "onsite",
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
      scheduled_at: "2026-09-12T10:00",
    });
    const interview = await Interview.findOrFail(created.interview.id);

    await expect(
      kioskService.save(candidate, {
        interview_id: Number(interview.id),
        overall_score: 5,
        recommendation: "hire",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(
      kioskService.save(recruiter, {
        interview_id: Number(interview.id),
        overall_score: 0,
        recommendation: "hire",
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityError);

    await expect(
      kioskService.save(recruiter, {
        interview_id: Number(interview.id),
        overall_score: 4,
        recommendation: "maybe",
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityError);

    await expect(
      kioskService.save(recruiter, {
        interview_id: 0,
        overall_score: 4,
        recommendation: "hire",
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityError);

    const saved = await kioskService.save(recruiter, {
      interview_id: Number(interview.id),
      overall_score: 4,
      recommendation: "hold",
      notes: "onsite",
    });
    expect(saved.synced_at).toBeNull();

    const listed = await kioskService.list(recruiter);
    expect(listed.some((row) => Number(row.id) === Number(saved.id))).toBe(true);
    const pending = await kioskService.listUnsynced(recruiter);
    expect(pending.some((row) => Number(row.id) === Number(saved.id))).toBe(true);

    const recruiterCookies = (await signInCookie("recruiter@hiroapp.com")).cookies;
    const primed = await request("/api/skills", { cookies: recruiterCookies });
    const token = csrfFrom(primed.cookies);
    const httpSave = await request("/api/kiosk/scorecards", {
      method: "POST",
      cookies: primed.cookies,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-csrf-token": token,
      },
      body: JSON.stringify({
        interview_id: Number(interview.id),
        overall_score: 5,
        recommendation: "hire",
        notes: "panel",
      }),
    });
    expect(httpSave.response.status).toBe(200);

    const synced = await kioskService.sync(recruiter);
    expect(synced.synced).toBeGreaterThan(0);
    expect((await kioskService.listUnsynced(recruiter)).length).toBe(0);
    expect((await kioskService.sync(recruiter)).synced).toBe(0);

    const html = await request("/kiosk", { cookies: recruiterCookies });
    expect(html.response.status).toBe(200);
    expect(html.text).toContain("Interview kiosk");
  });

  test("kiosk requires a named sqlite connection and a returning row", async () => {
    const recruiter = await seededUser("recruiter@hiroapp.com");
    const previous = getNamedConnection("kiosk");
    unregisterNamedConnection("kiosk");
    try {
      await expect(
        kioskService.save(recruiter, {
          interview_id: 1,
          overall_score: 3,
          recommendation: "hire",
        }),
      ).rejects.toBeInstanceOf(UnprocessableEntityError);
    } finally {
      registerNamedConnection("kiosk", previous.driver, previous.connection);
    }

    registerNamedConnection("kiosk", "sqlite", {
      async unsafe() {
        return [];
      },
    });
    try {
      await expect(
        kioskService.save(recruiter, {
          interview_id: 1,
          overall_score: 3,
          recommendation: "hire",
        }),
      ).rejects.toBeInstanceOf(UnprocessableEntityError);
    } finally {
      registerNamedConnection("kiosk", previous.driver, previous.connection);
    }
  });
});
