import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { hashPassword } from "@getstrata/core/auth/password";
import {
  ConflictError,
  ForbiddenError,
  UnprocessableEntityError,
} from "@getstrata/core/errors/http";
import { ROLE, STATUS } from "../lib/roles.ts";
import { Application } from "../models/Application.ts";
import { BackgroundCheck } from "../models/BackgroundCheck.ts";
import { Position } from "../models/Position.ts";
import { backgroundCheckService, serializeBackgroundCheck } from "../modules/checks/service.ts";
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

describe.skipIf(!enabled)("Wave 33 background checks", () => {
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
      name: `Check Seat ${Date.now()}-${Math.random()}`,
      description: "background-check",
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

  test("staff request, record, and cancel background checks", async () => {
    const candidate = await seededUser("candidate@hiroapp.com");
    const recruiter = await seededUser("recruiter@hiroapp.com");
    const other = await users.create({
      first_name: "Other",
      last_name: "Checked",
      email: `other.check.${Date.now()}@hiroapp.com`,
      password: await hashPassword("password"),
      role_id: ROLE.CANDIDATE,
    });
    const application = await openApplication(candidate.id);

    expect(await backgroundCheckService.forApplication(recruiter, application)).toBeNull();
    await expect(backgroundCheckService.forApplication(other, application)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(await backgroundCheckService.forApplication(candidate, application)).toBeNull();
    await expect(
      backgroundCheckService.request(candidate, application, { vendor: "Checkr" }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const created = await backgroundCheckService.request(recruiter, application, {
      vendor: "  Checkr  ",
      notes: "  standard pack  ",
    });
    expect(created.status).toBe("requested");
    expect(created.vendor).toBe("Checkr");
    expect(created.notes).toBe("standard pack");
    const model = await BackgroundCheck.findOrFail(created.id);
    expect(serializeBackgroundCheck(model).status).toBe("requested");
    expect(
      serializeBackgroundCheck({
        ...created,
        status: "nope" as never,
        completed_at: null,
      }).status,
    ).toBe("requested");
    expect((await application.backgroundCheck())?.id).toBe(created.id);
    await expect(
      backgroundCheckService.request(recruiter, application, { vendor: "Checkr" }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      backgroundCheckService.cancel(candidate, await BackgroundCheck.findOrFail(created.id)),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      backgroundCheckService.clear(candidate, await BackgroundCheck.findOrFail(created.id)),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      backgroundCheckService.record(
        recruiter,
        await BackgroundCheck.findOrFail(created.id),
        "nope" as never,
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityError);

    const keptNotes = await backgroundCheckService.clear(
      recruiter,
      await BackgroundCheck.findOrFail(created.id),
    );
    expect(keptNotes.status).toBe("clear");
    expect(keptNotes.notes).toBe("standard pack");
    expect(keptNotes.completed_at).not.toBeNull();
    await expect(backgroundCheckService.request(recruiter, application)).rejects.toBeInstanceOf(
      ForbiddenError,
    );

    const cancelApp = await openApplication(candidate.id);
    const toCancel = await backgroundCheckService.request(recruiter, cancelApp, {
      vendor: "Temp",
    });
    const cancelled = await backgroundCheckService.cancel(
      recruiter,
      await BackgroundCheck.findOrFail(toCancel.id),
    );
    expect(cancelled.status).toBe("cancelled");
    await expect(
      backgroundCheckService.cancel(recruiter, await BackgroundCheck.findOrFail(toCancel.id)),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      backgroundCheckService.clear(recruiter, await BackgroundCheck.findOrFail(toCancel.id)),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const reopened = await backgroundCheckService.request(recruiter, cancelApp, {
      vendor: "Sterling",
    });
    expect(reopened.id).toBe(toCancel.id);
    expect(reopened.status).toBe("requested");
    expect(reopened.vendor).toBe("Sterling");
    expect(reopened.completed_at).toBeNull();
    const clearedReopen = await backgroundCheckService.clear(
      recruiter,
      await BackgroundCheck.findOrFail(reopened.id),
      "  confirmed  ",
    );
    expect(clearedReopen.notes).toBe("confirmed");

    const flagApp = await openApplication(candidate.id);
    const flaggedRequest = await backgroundCheckService.request(recruiter, flagApp);
    expect(flaggedRequest.vendor).toBeNull();
    const flagged = await backgroundCheckService.flag(
      recruiter,
      await BackgroundCheck.findOrFail(flaggedRequest.id),
      "  record found  ",
    );
    expect(flagged.status).toBe("flagged");
    expect(flagged.notes).toBe("record found");
    await expect(backgroundCheckService.request(recruiter, flagApp)).rejects.toBeInstanceOf(
      ForbiddenError,
    );

    expect(await backgroundCheckService.forApplication(candidate, application)).toMatchObject({
      status: "clear",
    });

    const httpApp = await openApplication(candidate.id);
    const forbidden = await jsonRequest(`/api/applications/${httpApp.id}/background-check`, {
      cookies: candidateCookies,
      method: "POST",
      body: JSON.stringify({ vendor: "Checkr" }),
    });
    expect(forbidden.response.status).toBe(403);
    const empty = await jsonRequest(`/api/applications/${httpApp.id}/background-check`, {
      cookies: recruiterCookies,
    });
    expect(empty.body).toBeNull();
    const httpCreated = await jsonRequest(`/api/applications/${httpApp.id}/background-check`, {
      cookies: recruiterCookies,
      method: "POST",
      body: JSON.stringify({ vendor: "Checkr" }),
    });
    expect(httpCreated.body.status).toBe("requested");
    const httpClear = await jsonRequest(`/api/background-checks/${httpCreated.body.id}/clear`, {
      cookies: recruiterCookies,
      method: "POST",
      body: JSON.stringify({ notes: "clean" }),
    });
    expect(httpClear.body.status).toBe("clear");

    const flagHttpApp = await openApplication(other.id);
    const httpFlagReq = await jsonRequest(`/api/applications/${flagHttpApp.id}/background-check`, {
      cookies: recruiterCookies,
      method: "POST",
      body: JSON.stringify({}),
    });
    const httpFlag = await jsonRequest(`/api/background-checks/${httpFlagReq.body.id}/flag`, {
      cookies: recruiterCookies,
      method: "POST",
      body: JSON.stringify({ notes: "issue" }),
    });
    expect(httpFlag.body.status).toBe("flagged");

    const cancelHttpApp = await openApplication(other.id);
    const httpCancelReq = await jsonRequest(
      `/api/applications/${cancelHttpApp.id}/background-check`,
      {
        cookies: recruiterCookies,
        method: "POST",
        body: JSON.stringify({ vendor: "Checkr" }),
      },
    );
    const httpCancel = await jsonRequest(`/api/background-checks/${httpCancelReq.body.id}/cancel`, {
      cookies: recruiterCookies,
      method: "POST",
    });
    expect(httpCancel.body.status).toBe("cancelled");

    const htmlApp = await openApplication(candidate.id);
    const appPage = await request(`/applications/${htmlApp.id}`, { cookies: recruiterCookies });
    expect(appPage.response.status).toBe(200);
    const htmlRequest = await request(`/applications/${htmlApp.id}/background-check`, {
      cookies: appPage.cookies,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-csrf-token": csrfFrom(appPage.cookies),
      },
      body: `vendor=HTMLCheck&notes=html&return_to=/applications/${htmlApp.id}`,
    });
    expect([302, 303].includes(htmlRequest.response.status)).toBe(true);
    const htmlCheck = await backgroundCheckService.forApplication(recruiter, htmlApp);
    if (!htmlCheck) {
      throw new Error("missing html check");
    }
    const clearPage = await request(`/applications/${htmlApp.id}`, { cookies: recruiterCookies });
    const htmlClear = await request(`/background-checks/${htmlCheck.id}/clear`, {
      cookies: clearPage.cookies,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-csrf-token": csrfFrom(clearPage.cookies),
      },
      body: `return_to=/applications/${htmlApp.id}`,
    });
    expect([302, 303].includes(htmlClear.response.status)).toBe(true);

    const htmlFlagApp = await openApplication(candidate.id);
    await backgroundCheckService.request(recruiter, htmlFlagApp, { vendor: "FlagCo" });
    const htmlFlagCheck = await backgroundCheckService.forApplication(recruiter, htmlFlagApp);
    if (!htmlFlagCheck) {
      throw new Error("missing html flag check");
    }
    const flagPage = await request(`/applications/${htmlFlagApp.id}`, {
      cookies: recruiterCookies,
    });
    const htmlFlag = await request(`/background-checks/${htmlFlagCheck.id}/flag`, {
      cookies: flagPage.cookies,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-csrf-token": csrfFrom(flagPage.cookies),
      },
      body: `notes=html+flag&return_to=/applications/${htmlFlagApp.id}`,
    });
    expect([302, 303].includes(htmlFlag.response.status)).toBe(true);

    const htmlCancelApp = await openApplication(candidate.id);
    await backgroundCheckService.request(recruiter, htmlCancelApp, { vendor: "CancelCo" });
    const htmlCancelCheck = await backgroundCheckService.forApplication(recruiter, htmlCancelApp);
    if (!htmlCancelCheck) {
      throw new Error("missing html cancel check");
    }
    const cancelPage = await request(`/applications/${htmlCancelApp.id}`, {
      cookies: recruiterCookies,
    });
    const htmlCancel = await request(`/background-checks/${htmlCancelCheck.id}/cancel`, {
      cookies: cancelPage.cookies,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-csrf-token": csrfFrom(cancelPage.cookies),
      },
      body: `return_to=/applications/${htmlCancelApp.id}`,
    });
    expect([302, 303].includes(htmlCancel.response.status)).toBe(true);
  });
});
