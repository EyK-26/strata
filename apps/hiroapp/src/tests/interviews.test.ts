import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { hashPassword } from "@getstrata/core/auth/password";
import { ForbiddenError, NotFoundError, ValidationError } from "@getstrata/core/errors/http";
import { ROLE, STATUS } from "../lib/roles.ts";
import { Application } from "../models/Application.ts";
import { Interview } from "../models/Interview.ts";
import { Position } from "../models/Position.ts";
import { interviewService, serializeInterview } from "../modules/interviews/service.ts";
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

describe.skipIf(!enabled)("Wave 13 interviews", () => {
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

  test("staff schedule, candidate confirm, staff complete and cancel", async () => {
    const candidate = await seededUser("candidate@hiroapp.com");
    const recruiter = await seededUser("recruiter@hiroapp.com");
    const admin = await seededUser("admin@hiroapp.com");

    const seat = await Position.create({
      user_id: null,
      department_id: 1,
      grade_id: 1,
      name: `Interview Seat ${Date.now()}`,
      description: "panel",
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

    await expect(
      interviewService.schedule(candidate, {
        application_id: Number(application.id),
        scheduled_at: "2026-09-10T10:00",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      interviewService.schedule(recruiter, {
        application_id: 9_999_999,
        scheduled_at: "2026-09-10T10:00",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      interviewService.schedule(recruiter, {
        application_id: Number(application.id),
        scheduled_at: "not-a-date",
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    const created = await interviewService.schedule(recruiter, {
      application_id: Number(application.id),
      scheduled_at: "2026-09-10T10:00",
      place: "  ",
      notes: "  ",
    });
    expect(created.interview.status).toBe("scheduled");
    expect(created.interview.place).toBeNull();
    expect(typeof created.confirm_url).toBe("string");
    expect(serializeInterview(created.interview).id).toBe(created.interview.id);
    const model = await Interview.findOrFail(created.interview.id);
    expect(serializeInterview(model).status).toBe("scheduled");
    expect(serializeInterview({ ...created.interview, status: "nope" as never }).status).toBe(
      "scheduled",
    );

    const listed = await jsonRequest(`/api/applications/${application.id}/interviews`, {
      cookies: recruiterCookies,
    });
    expect(listed.response.status).toBe(200);
    expect(listed.body.length).toBeGreaterThan(0);

    const other = await users.create({
      first_name: "Other",
      last_name: "Candidate",
      email: `other.interview.${Date.now()}@hiroapp.com`,
      password: await hashPassword("password"),
      role_id: ROLE.CANDIDATE,
    });
    await expect(
      interviewService.listForApplication(other, Number(application.id)),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await interviewService.listForActor(other)).toEqual([]);

    await expect(interviewService.confirm(other, model)).rejects.toBeInstanceOf(ForbiddenError);
    const confirmed = await interviewService.confirm(candidate, model);
    expect(confirmed.status).toBe("confirmed");
    await expect(
      interviewService.confirm(candidate, await Interview.findOrFail(model.id)),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const completed = await interviewService.complete(
      recruiter,
      await Interview.findOrFail(model.id),
      "strong hire",
    );
    expect(completed.status).toBe("completed");
    expect(completed.notes).toBe("strong hire");
    await expect(
      interviewService.complete(recruiter, await Interview.findOrFail(model.id)),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      interviewService.cancel(recruiter, await Interview.findOrFail(model.id)),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const second = await interviewService.schedule(admin, {
      application_id: Number(application.id),
      scheduled_at: "2026-09-11T11:00",
      place: "Office",
      notes: "panel",
      text: "Please join",
    });
    const http = await jsonRequest("/api/interviews", {
      cookies: recruiterCookies,
      method: "POST",
      body: JSON.stringify({
        application_id: Number(application.id),
        scheduled_at: "2026-09-12T09:00",
        place: "Zoom",
        text: "http",
      }),
    });
    expect(http.response.status).toBe(200);
    expect(http.body.confirm_url).toBeTruthy();

    const signed = await jsonRequest(second.confirm_url, { cookies: candidateCookies });
    expect(signed.response.status).toBe(200);
    expect(signed.body.confirmed).toBe(true);

    const posted = await jsonRequest(`/api/interviews/${http.body.id}/confirm`, {
      cookies: candidateCookies,
      method: "POST",
    });
    expect(posted.body.confirmed).toBe(true);

    const keepNotes = await interviewService.complete(
      recruiter,
      await Interview.findOrFail(second.interview.id),
      "  ",
    );
    expect(keepNotes.notes).toBe("panel");

    const toCancel = await interviewService.schedule(recruiter, {
      application_id: Number(application.id),
      scheduled_at: "2026-09-13T15:00",
    });
    await expect(
      interviewService.complete(candidate, await Interview.findOrFail(toCancel.interview.id)),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      interviewService.cancel(candidate, await Interview.findOrFail(toCancel.interview.id)),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const cancelled = await interviewService.cancel(
      recruiter,
      await Interview.findOrFail(toCancel.interview.id),
    );
    expect(cancelled.status).toBe("cancelled");

    const confirmThenCancel = await interviewService.schedule(recruiter, {
      application_id: Number(application.id),
      scheduled_at: "2026-09-16T15:00",
    });
    await interviewService.confirm(
      candidate,
      await Interview.findOrFail(confirmThenCancel.interview.id),
    );
    const cancelledConfirmed = await interviewService.cancel(
      recruiter,
      await Interview.findOrFail(confirmThenCancel.interview.id),
    );
    expect(cancelledConfirmed.status).toBe("cancelled");

    const fromScheduled = await interviewService.schedule(recruiter, {
      application_id: Number(application.id),
      scheduled_at: "2026-09-14T15:00",
    });
    const completedScheduled = await interviewService.complete(
      recruiter,
      await Interview.findOrFail(fromScheduled.interview.id),
      null,
    );
    expect(completedScheduled.status).toBe("completed");
    expect(completedScheduled.notes).toBeNull();

    const mine = await jsonRequest("/api/interviews", { cookies: candidateCookies });
    expect(mine.response.status).toBe(200);
    expect(mine.body.length).toBeGreaterThan(0);
    const staff = await jsonRequest("/api/interviews", { cookies: adminCookies });
    expect(staff.response.status).toBe(200);

    const page = await request("/interviews", { cookies: candidateCookies });
    expect(page.response.status).toBe(200);
    expect(page.text).toContain("Interviews");

    const detail = await jsonRequest(`/api/applications/${application.id}`, {
      cookies: candidateCookies,
    });
    expect(Array.isArray(detail.body.interviews)).toBe(true);
    expect((await application.interviews()).length).toBeGreaterThan(0);

    const emptyCandidate = await users.create({
      first_name: "None",
      last_name: "Apps",
      email: `none.interview.${Date.now()}@hiroapp.com`,
      password: await hashPassword("password"),
      role_id: ROLE.CANDIDATE,
    });
    expect(await interviewService.listForActor(emptyCandidate)).toEqual([]);

    const orphan = await users.create({
      first_name: "Orphan",
      last_name: "Interviewer",
      email: `orphan.interview.${Date.now()}@hiroapp.com`,
      password: await hashPassword("password"),
      role_id: ROLE.RECRUITER,
      current_department_id: null,
    });
    await expect(interviewService.listForActor(orphan)).rejects.toBeInstanceOf(ForbiddenError);

    const { departments } = await import("../modules/departments/repository.ts");
    const { departmentMembers } = await import("../modules/teams/memberRepository.ts");
    const emptyTeam = await departments.create({ name: `Interview Team ${Date.now()}` });
    await departmentMembers.create({
      department_id: emptyTeam.id,
      user_id: orphan.id,
      role: "member",
    });
    await users.updateById(orphan.id, { current_department_id: emptyTeam.id });
    expect(await interviewService.listForActor(await users.findByIdOrThrow(orphan.id))).toEqual([]);

    const httpCompleteTarget = await interviewService.schedule(recruiter, {
      application_id: Number(application.id),
      scheduled_at: "2026-09-17T10:00",
    });
    const completeOk = await jsonRequest(
      `/api/interviews/${httpCompleteTarget.interview.id}/complete`,
      {
        cookies: recruiterCookies,
        method: "POST",
        body: JSON.stringify({ notes: "done" }),
      },
    );
    expect(completeOk.response.status).toBe(200);
    expect(completeOk.body.status).toBe("completed");

    const httpCancelTarget = await interviewService.schedule(recruiter, {
      application_id: Number(application.id),
      scheduled_at: "2026-09-18T10:00",
    });
    const cancelOk = await jsonRequest(`/api/interviews/${httpCancelTarget.interview.id}/cancel`, {
      cookies: recruiterCookies,
      method: "POST",
    });
    expect(cancelOk.response.status).toBe(200);
    expect(cancelOk.body.status).toBe("cancelled");

    const missing = await jsonRequest("/api/applications/999999/interviews", {
      cookies: recruiterCookies,
    });
    expect(missing.response.status).toBe(404);

    const completeHttp = await jsonRequest(
      `/api/interviews/${fromScheduled.interview.id}/complete`,
      {
        cookies: recruiterCookies,
        method: "POST",
        body: JSON.stringify({}),
      },
    );
    expect(completeHttp.response.status).toBe(403);

    const cancelHttp = await jsonRequest(`/api/interviews/${toCancel.interview.id}/cancel`, {
      cookies: recruiterCookies,
      method: "POST",
    });
    expect(cancelHttp.response.status).toBe(403);

    const forbiddenCreate = await jsonRequest("/api/interviews", {
      cookies: candidateCookies,
      method: "POST",
      body: JSON.stringify({
        application_id: Number(application.id),
        scheduled_at: "2026-09-15T10:00",
      }),
    });
    expect(forbiddenCreate.response.status).toBe(403);
  });

  test("staff mark scheduled and confirmed interviews as no-show", async () => {
    const candidate = await seededUser("candidate@hiroapp.com");
    const recruiter = await seededUser("recruiter@hiroapp.com");

    const seat = await Position.create({
      user_id: null,
      department_id: 1,
      grade_id: 1,
      name: `No-show Seat ${Date.now()}`,
      description: "panel",
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

    const scheduled = await interviewService.schedule(recruiter, {
      application_id: Number(application.id),
      scheduled_at: "2026-10-01T10:00",
    });
    await expect(
      interviewService.noShow(candidate, await Interview.findOrFail(scheduled.interview.id)),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const marked = await interviewService.noShow(
      recruiter,
      await Interview.findOrFail(scheduled.interview.id),
    );
    expect(marked.status).toBe("no_show");
    expect(serializeInterview(marked).status).toBe("no_show");
    await expect(
      interviewService.noShow(recruiter, await Interview.findOrFail(marked.id)),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      interviewService.reschedule(recruiter, await Interview.findOrFail(marked.id), {
        scheduled_at: "2026-10-02T10:00",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const confirmedTarget = await interviewService.schedule(recruiter, {
      application_id: Number(application.id),
      scheduled_at: "2026-10-03T10:00",
    });
    await interviewService.confirm(
      candidate,
      await Interview.findOrFail(confirmedTarget.interview.id),
    );
    const confirmedNoShow = await interviewService.noShow(
      recruiter,
      await Interview.findOrFail(confirmedTarget.interview.id),
    );
    expect(confirmedNoShow.status).toBe("no_show");

    const completedTarget = await interviewService.schedule(recruiter, {
      application_id: Number(application.id),
      scheduled_at: "2026-10-04T10:00",
    });
    await interviewService.complete(
      recruiter,
      await Interview.findOrFail(completedTarget.interview.id),
    );
    await expect(
      interviewService.noShow(recruiter, await Interview.findOrFail(completedTarget.interview.id)),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const cancelledTarget = await interviewService.schedule(recruiter, {
      application_id: Number(application.id),
      scheduled_at: "2026-10-05T10:00",
    });
    await interviewService.cancel(
      recruiter,
      await Interview.findOrFail(cancelledTarget.interview.id),
    );
    await expect(
      interviewService.noShow(recruiter, await Interview.findOrFail(cancelledTarget.interview.id)),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const httpTarget = await interviewService.schedule(recruiter, {
      application_id: Number(application.id),
      scheduled_at: "2026-10-06T10:00",
    });
    const forbiddenHttp = await jsonRequest(`/api/interviews/${httpTarget.interview.id}/no-show`, {
      cookies: candidateCookies,
      method: "POST",
    });
    expect(forbiddenHttp.response.status).toBe(403);
    const httpOk = await jsonRequest(`/api/interviews/${httpTarget.interview.id}/no-show`, {
      cookies: recruiterCookies,
      method: "POST",
    });
    expect(httpOk.response.status).toBe(200);
    expect(httpOk.body.status).toBe("no_show");

    const alreadyDone = await jsonRequest(`/api/interviews/${httpTarget.interview.id}/no-show`, {
      cookies: recruiterCookies,
      method: "POST",
    });
    expect(alreadyDone.response.status).toBe(403);

    const htmlTarget = await interviewService.schedule(recruiter, {
      application_id: Number(application.id),
      scheduled_at: "2026-10-07T10:00",
    });
    const primed = await request("/interviews", { cookies: recruiterCookies });
    expect(primed.response.status).toBe(200);
    expect(primed.text).toContain("Mark no-show");
    const html = await request(`/interviews/${htmlTarget.interview.id}/no-show`, {
      cookies: primed.cookies,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-csrf-token": csrfFrom(primed.cookies),
      },
      body: "return_to=/interviews",
    });
    expect([302, 303].includes(html.response.status)).toBe(true);
    const htmlRow = await Interview.findOrFail(htmlTarget.interview.id);
    expect(htmlRow.get("status")).toBe("no_show");

    const appHtmlTarget = await interviewService.schedule(recruiter, {
      application_id: Number(application.id),
      scheduled_at: "2026-10-08T10:00",
    });
    const appPage = await request(`/applications/${application.id}`, { cookies: recruiterCookies });
    expect(appPage.response.status).toBe(200);
    expect(appPage.text).toContain("Mark no-show");
    const appHtml = await request(`/interviews/${appHtmlTarget.interview.id}/no-show`, {
      cookies: appPage.cookies,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-csrf-token": csrfFrom(appPage.cookies),
      },
      body: `return_to=/applications/${application.id}`,
    });
    expect([302, 303].includes(appHtml.response.status)).toBe(true);
  });

  test("candidate declines scheduled and confirmed interviews", async () => {
    const candidate = await seededUser("candidate@hiroapp.com");
    const recruiter = await seededUser("recruiter@hiroapp.com");

    const seat = await Position.create({
      user_id: null,
      department_id: 1,
      grade_id: 1,
      name: `Decline Seat ${Date.now()}`,
      description: "panel",
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

    const scheduled = await interviewService.schedule(recruiter, {
      application_id: Number(application.id),
      scheduled_at: "2026-11-01T10:00",
    });
    await expect(
      interviewService.decline(recruiter, await Interview.findOrFail(scheduled.interview.id)),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const declined = await interviewService.decline(
      candidate,
      await Interview.findOrFail(scheduled.interview.id),
    );
    expect(declined.status).toBe("declined");
    expect(serializeInterview(declined).status).toBe("declined");
    await expect(
      interviewService.decline(candidate, await Interview.findOrFail(declined.id)),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      interviewService.confirm(candidate, await Interview.findOrFail(declined.id)),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      interviewService.noShow(recruiter, await Interview.findOrFail(declined.id)),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const confirmedTarget = await interviewService.schedule(recruiter, {
      application_id: Number(application.id),
      scheduled_at: "2026-11-02T10:00",
    });
    await interviewService.confirm(
      candidate,
      await Interview.findOrFail(confirmedTarget.interview.id),
    );
    const confirmedDeclined = await interviewService.decline(
      candidate,
      await Interview.findOrFail(confirmedTarget.interview.id),
    );
    expect(confirmedDeclined.status).toBe("declined");

    const completedTarget = await interviewService.schedule(recruiter, {
      application_id: Number(application.id),
      scheduled_at: "2026-11-03T10:00",
    });
    await interviewService.complete(
      recruiter,
      await Interview.findOrFail(completedTarget.interview.id),
    );
    await expect(
      interviewService.decline(candidate, await Interview.findOrFail(completedTarget.interview.id)),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const httpTarget = await interviewService.schedule(recruiter, {
      application_id: Number(application.id),
      scheduled_at: "2026-11-04T10:00",
    });
    const forbiddenHttp = await jsonRequest(`/api/interviews/${httpTarget.interview.id}/decline`, {
      cookies: recruiterCookies,
      method: "POST",
    });
    expect(forbiddenHttp.response.status).toBe(403);
    const httpOk = await jsonRequest(`/api/interviews/${httpTarget.interview.id}/decline`, {
      cookies: candidateCookies,
      method: "POST",
    });
    expect(httpOk.response.status).toBe(200);
    expect(httpOk.body.status).toBe("declined");

    const htmlTarget = await interviewService.schedule(recruiter, {
      application_id: Number(application.id),
      scheduled_at: "2026-11-05T10:00",
    });
    const primed = await request("/interviews", { cookies: candidateCookies });
    expect(primed.response.status).toBe(200);
    expect(primed.text).toContain("Decline interview");
    const html = await request(`/interviews/${htmlTarget.interview.id}/decline`, {
      cookies: primed.cookies,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-csrf-token": csrfFrom(primed.cookies),
      },
      body: "return_to=/interviews",
    });
    expect([302, 303].includes(html.response.status)).toBe(true);
    const htmlRow = await Interview.findOrFail(htmlTarget.interview.id);
    expect(htmlRow.get("status")).toBe("declined");

    const appHtmlTarget = await interviewService.schedule(recruiter, {
      application_id: Number(application.id),
      scheduled_at: "2026-11-06T10:00",
    });
    const appPage = await request(`/applications/${application.id}`, { cookies: candidateCookies });
    expect(appPage.response.status).toBe(200);
    expect(appPage.text).toContain("Decline interview");
    const appHtml = await request(`/interviews/${appHtmlTarget.interview.id}/decline`, {
      cookies: appPage.cookies,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-csrf-token": csrfFrom(appPage.cookies),
      },
      body: `return_to=/applications/${application.id}`,
    });
    expect([302, 303].includes(appHtml.response.status)).toBe(true);
  });
});
