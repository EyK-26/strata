import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { hashPassword } from "@getstrata/core/auth/password";
import {
  ConflictError,
  ForbiddenError,
  UnprocessableEntityError,
} from "@getstrata/core/errors/http";
import { ROLE, STATUS } from "../lib/roles.ts";
import { Application } from "../models/Application.ts";
import { ApplicationHold } from "../models/ApplicationHold.ts";
import { Position } from "../models/Position.ts";
import { holdService, serializeHold } from "../modules/holds/service.ts";
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

describe.skipIf(!enabled)("Wave 38 application holds", () => {
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

  async function openApplication(userId: number, statusId = STATUS.FEEDBACK) {
    const seat = await Position.create({
      user_id: null,
      department_id: 1,
      grade_id: 1,
      name: `Hold Seat ${Date.now()}-${Math.random()}`,
      description: "hold",
      hiring: true,
      start_date: null,
      end_date: null,
    });
    return Application.create({
      user_id: userId,
      position_id: Number(seat.id),
      status_id: statusId,
      attachment_text: null,
      attachment_file: null,
    });
  }

  test("staff hold and release open applications", async () => {
    const candidate = await seededUser("candidate@hiroapp.com");
    const recruiter = await seededUser("recruiter@hiroapp.com");
    const other = await users.create({
      first_name: "Other",
      last_name: "Held",
      email: `other.hold.${Date.now()}@hiroapp.com`,
      password: await hashPassword("password"),
      role_id: ROLE.CANDIDATE,
    });
    const application = await openApplication(candidate.id);
    const hired = await openApplication(candidate.id, STATUS.HIRED);
    const ended = await openApplication(candidate.id, STATUS.ENDED);

    expect(await holdService.forApplication(recruiter, application)).toBeNull();
    await expect(holdService.forApplication(other, application)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(await holdService.forApplication(candidate, application)).toBeNull();
    await expect(holdService.hold(candidate, application)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(holdService.hold(recruiter, hired)).rejects.toBeInstanceOf(
      UnprocessableEntityError,
    );
    await expect(holdService.hold(recruiter, ended)).rejects.toBeInstanceOf(
      UnprocessableEntityError,
    );

    const created = await holdService.hold(recruiter, application, {
      notes: "  waiting on team  ",
    });
    expect(created.status).toBe("holding");
    expect(created.notes).toBe("waiting on team");
    const model = await ApplicationHold.findOrFail(created.id);
    expect(serializeHold(model).status).toBe("holding");
    expect(serializeHold({ ...created, status: "nope" as never, released_by: null }).status).toBe(
      "released",
    );
    expect((await application.hold())?.id).toBe(created.id);
    await expect(holdService.hold(recruiter, application)).rejects.toBeInstanceOf(ConflictError);
    await expect(
      holdService.release(candidate, await ApplicationHold.findOrFail(created.id)),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const released = await holdService.release(
      recruiter,
      await ApplicationHold.findOrFail(created.id),
    );
    expect(released.status).toBe("released");
    expect(released.released_by).toBe(recruiter.id);
    expect(released.released_at).not.toBeNull();
    await expect(
      holdService.release(recruiter, await ApplicationHold.findOrFail(created.id)),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const reheld = await holdService.hold(recruiter, application, { notes: "again" });
    expect(reheld.id).toBe(created.id);
    expect(reheld.status).toBe("holding");
    expect(reheld.released_by).toBeNull();
    expect(reheld.released_at).toBeNull();
    expect(await holdService.forApplication(candidate, application)).toMatchObject({
      status: "holding",
    });

    const httpApp = await openApplication(candidate.id);
    const forbidden = await jsonRequest(`/api/applications/${httpApp.id}/hold`, {
      cookies: candidateCookies,
      method: "POST",
      body: JSON.stringify({ notes: "nope" }),
    });
    expect(forbidden.response.status).toBe(403);
    const empty = await jsonRequest(`/api/applications/${httpApp.id}/hold`, {
      cookies: recruiterCookies,
    });
    expect(empty.body).toBeNull();
    const httpCreated = await jsonRequest(`/api/applications/${httpApp.id}/hold`, {
      cookies: recruiterCookies,
      method: "POST",
      body: JSON.stringify({ notes: "api" }),
    });
    expect(httpCreated.body.status).toBe("holding");
    const httpRelease = await jsonRequest(`/api/holds/${httpCreated.body.id}/release`, {
      cookies: recruiterCookies,
      method: "POST",
    });
    expect(httpRelease.body.status).toBe("released");

    const htmlApp = await openApplication(candidate.id);
    const page = await request(`/applications/${htmlApp.id}`, { cookies: recruiterCookies });
    expect(page.response.status).toBe(200);
    const htmlHold = await request(`/applications/${htmlApp.id}/hold`, {
      cookies: page.cookies,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-csrf-token": csrfFrom(page.cookies),
      },
      body: `notes=html&return_to=/applications/${htmlApp.id}`,
    });
    expect([302, 303].includes(htmlHold.response.status)).toBe(true);
    const htmlRow = await holdService.forApplication(recruiter, htmlApp);
    if (!htmlRow) {
      throw new Error("missing html hold");
    }
    const releasePage = await request(`/applications/${htmlApp.id}`, { cookies: recruiterCookies });
    const htmlRelease = await request(`/holds/${htmlRow.id}/release`, {
      cookies: releasePage.cookies,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-csrf-token": csrfFrom(releasePage.cookies),
      },
      body: `return_to=/applications/${htmlApp.id}`,
    });
    expect([302, 303].includes(htmlRelease.response.status)).toBe(true);
  });
});
