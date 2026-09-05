import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { ROLE, STATUS } from "../lib/roles.ts";
import { Application } from "../models/Application.ts";
import { Interview } from "../models/Interview.ts";
import { Position } from "../models/Position.ts";
import { interviewService } from "../modules/interviews/service.ts";
import { notifyUser } from "../modules/notifications/service.ts";
import { requisitionService } from "../modules/requisitions/service.ts";
import {
  bootHiroapp,
  collectCookies,
  cookieHeader,
  csrfFrom,
  seededUser,
  signInCookie,
} from "./helpers.ts";

const enabled = process.env.HIROAPP_TEST === "1";

describe.skipIf(!enabled)("Waves 52-58 hiring OS HTML", () => {
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

  async function openSeat() {
    return Position.create({
      user_id: null,
      department_id: 1,
      grade_id: 1,
      name: `Ops Seat ${Date.now()}-${Math.random()}`,
      description: "ops",
      hiring: true,
      start_date: null,
      end_date: null,
    });
  }

  test("inbox, pipeline filters, referrals, requisitions, and team pages", async () => {
    const candidate = await seededUser("candidate@hiroapp.com");
    await notifyUser({
      userId: candidate.id,
      type: "App\\Notifications\\ContactUser",
      data: { from: "HiroApp", subject: "ops-inbox" },
    });

    const inbox = await request("/inbox", { cookies: candidateCookies });
    expect(inbox.response.status).toBe(200);
    expect(inbox.text).toContain("Inbox");
    expect(inbox.text).toContain("Mark as read");

    const unread = inbox.text.match(/action="\/inbox\/([^"]+)\/read"/);
    expect(unread?.[1]).toBeTruthy();
    const marked = await request(`/inbox/${unread![1]}/read`, {
      cookies: inbox.cookies,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-csrf-token": csrfFrom(inbox.cookies),
      },
      body: "return_to=/inbox",
    });
    expect([302, 303].includes(marked.response.status)).toBe(true);

    const pipeline = await request("/applications?search=Engineer", { cookies: recruiterCookies });
    expect(pipeline.response.status).toBe(200);
    expect(pipeline.text).toContain("Filter pipeline");
    expect(pipeline.text).toContain("Export applications");

    const exported = await request("/applications/export", { cookies: recruiterCookies });
    expect(exported.response.status).toBe(200);
    expect(JSON.parse(exported.text).count).toBeGreaterThan(0);

    const forbiddenExport = await request("/applications/export", { cookies: candidateCookies });
    expect(forbiddenExport.response.status).toBe(403);

    const referrals = await request("/referrals", { cookies: recruiterCookies });
    expect(referrals.response.status).toBe(200);
    expect(referrals.text).toContain("My referrals");

    const recruiter = await seededUser("recruiter@hiroapp.com");
    const seat = await openSeat();
    await requisitionService.submit(recruiter, seat, { notes: "ops queue" });
    const queue = await request("/requisitions", { cookies: adminCookies });
    expect(queue.response.status).toBe(200);
    expect(queue.text).toContain("Requisition queue");
    expect(queue.text).toContain("Approve");
    const listed = await jsonRequest("/api/requisitions", { cookies: adminCookies });
    expect(listed.body.some((row: { notes: string | null }) => row.notes === "ops queue")).toBe(
      true,
    );

    const teams = await jsonRequest("/api/users/me/departments", { cookies: recruiterCookies });
    const recruiterTeam = await request(`/departments/${teams.body.current_department_id}`, {
      cookies: recruiterCookies,
    });
    expect(recruiterTeam.response.status).toBe(200);
    expect(recruiterTeam.text).toContain("Members");
    const teamPage = await request(`/departments/${teams.body.current_department_id}`, {
      cookies: adminCookies,
    });
    expect(teamPage.response.status).toBe(200);
    expect(teamPage.text).toContain("Send invite");
  });

  test("withdrawn restore, deleted seat restore, interview complete/cancel HTML", async () => {
    const candidate = await seededUser("candidate@hiroapp.com");
    const recruiter = await seededUser("recruiter@hiroapp.com");
    const seat = await openSeat();
    const application = await Application.create({
      user_id: candidate.id,
      position_id: Number(seat.id),
      status_id: STATUS.IN_PROGRESS,
      attachment_text: null,
      attachment_file: null,
    });
    await application.delete();

    const withdrawn = await request("/applications/withdrawn", { cookies: recruiterCookies });
    expect(withdrawn.response.status).toBe(200);
    expect(withdrawn.text).toContain("Restore application");
    const restored = await request(`/applications/${application.id}/restore`, {
      cookies: withdrawn.cookies,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-csrf-token": csrfFrom(withdrawn.cookies),
      },
    });
    expect([302, 303].includes(restored.response.status)).toBe(true);
    expect(await Application.find(application.id)).toBeTruthy();

    const interview = await interviewService.schedule(recruiter, {
      application_id: Number(application.id),
      scheduled_at: "2026-11-01T10:00",
      place: "Zoom",
    });
    const appPage = await request(`/applications/${application.id}`, { cookies: recruiterCookies });
    expect(appPage.text).toContain("Complete interview");
    expect(appPage.text).toContain("Cancel interview");
    expect(appPage.text).toContain("Save scorecard");
    expect(appPage.text).toContain("Hiring seat");
    expect(appPage.text).not.toMatch(/<p>\s*undefined\s*<\/p>/);
    expect(appPage.text).not.toMatch(/<p>\s*null\s*<\/p>/);
    const complete = await request(`/interviews/${interview.interview.id}/complete`, {
      cookies: appPage.cookies,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-csrf-token": csrfFrom(appPage.cookies),
      },
      body: `notes=ops&return_to=/applications/${application.id}`,
    });
    expect([302, 303].includes(complete.response.status)).toBe(true);
    expect((await Interview.findOrFail(interview.interview.id)).get("status")).toBe("completed");

    const other = await interviewService.schedule(recruiter, {
      application_id: Number(application.id),
      scheduled_at: "2026-11-02T10:00",
    });
    const cancelPage = await request(`/applications/${application.id}`, {
      cookies: recruiterCookies,
    });
    const cancelled = await request(`/interviews/${other.interview.id}/cancel`, {
      cookies: cancelPage.cookies,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-csrf-token": csrfFrom(cancelPage.cookies),
      },
      body: `return_to=/applications/${application.id}`,
    });
    expect([302, 303].includes(cancelled.response.status)).toBe(true);

    const candidatePage = await request(`/applications/${application.id}`, {
      cookies: candidateCookies,
    });
    expect(candidatePage.text).not.toContain("Transfer application");
    expect(candidatePage.text).not.toContain("Complete interview");
    expect(candidatePage.text).not.toContain("Save scorecard");
    expect(candidatePage.text).not.toContain("Schedule interview");
    expect(candidatePage.text).not.toContain("Reject with reason");
    expect(candidatePage.text).toContain("Withdraw application");

    const admin = await seededUser("admin@hiroapp.com");
    const doomed = await openSeat();
    await doomed.delete();
    const deletedPage = await request("/positions/deleted", { cookies: adminCookies });
    expect(deletedPage.response.status).toBe(200);
    expect(deletedPage.text).toContain("Restore position");
    const restoredSeat = await request(`/positions/${doomed.id}/restore`, {
      cookies: deletedPage.cookies,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-csrf-token": csrfFrom(deletedPage.cookies),
      },
    });
    expect([302, 303].includes(restoredSeat.response.status)).toBe(true);
    expect(await Position.find(doomed.id)).toBeTruthy();
    expect(Number(admin.role_id)).toBe(ROLE.ADMIN);
  });
});
