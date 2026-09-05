import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { hashPassword } from "@getstrata/core/auth/password";
import {
  ConflictError,
  ForbiddenError,
  UnprocessableEntityError,
} from "@getstrata/core/errors/http";
import { ROLE, STATUS } from "../lib/roles.ts";
import { Application } from "../models/Application.ts";
import { Position } from "../models/Position.ts";
import { applicationService } from "../modules/applications/service.ts";
import { departmentService } from "../modules/departments/service.ts";
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

async function unusedHiringPosition(userId: number, departmentId = 1) {
  const applied = await Application.withTrashed().where({ user_id: userId }).get();
  const used = new Set(applied.map((row) => Number(row.get("position_id"))));
  const hiring = await Position.where({ hiring: true, department_id: departmentId }).get();
  const open = hiring.find((row) => !used.has(Number(row.id)));
  if (open) {
    return open;
  }
  return Position.create({
    user_id: null,
    department_id: departmentId,
    grade_id: 1,
    name: `Transfer Open ${Date.now()}-${Math.random()}`,
    description: "transfer seat",
    hiring: true,
    start_date: null,
    end_date: null,
  });
}

describe.skipIf(!enabled)("Wave 47 transfer application to another hiring seat", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl = "";
  let candidateCookies: string[] = [];
  let recruiterCookies: string[] = [];

  beforeAll(async () => {
    const boot = await bootHiroapp();
    server = boot.server;
    baseUrl = boot.baseUrl;
    candidateCookies = (await signInCookie("candidate@hiroapp.com")).cookies;
    recruiterCookies = (await signInCookie("recruiter@hiroapp.com")).cookies;
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

  test("staff transfer open applications; JSON and HTML keep status", async () => {
    const candidate = await seededUser("candidate@hiroapp.com");
    const recruiter = await seededUser("recruiter@hiroapp.com");
    const admin = await seededUser("admin@hiroapp.com");

    const source = await unusedHiringPosition(candidate.id);
    const application = await applicationService.apply(candidate, {
      position_id: Number(source.id),
      attachment_text: "transfer me",
      attachment_file: null,
    });
    await application.update({ status_id: STATUS.IN_PROGRESS });
    const refreshed = await Application.findOrFail(application.id);

    await expect(
      applicationService.transfer(candidate, refreshed, { position_id: Number(source.id) }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const hired = await Application.create({
      user_id: candidate.id,
      position_id: null,
      status_id: STATUS.HIRED,
      attachment_text: null,
      attachment_file: null,
    });
    await expect(
      applicationService.transfer(recruiter, hired, { position_id: 1 }),
    ).rejects.toBeInstanceOf(UnprocessableEntityError);
    const ended = await Application.create({
      user_id: candidate.id,
      position_id: null,
      status_id: STATUS.ENDED,
      attachment_text: null,
      attachment_file: null,
    });
    await expect(
      applicationService.transfer(recruiter, ended, { position_id: 1 }),
    ).rejects.toBeInstanceOf(UnprocessableEntityError);

    await expect(
      applicationService.transfer(recruiter, refreshed, { position_id: Number(source.id) }),
    ).rejects.toBeInstanceOf(UnprocessableEntityError);
    await expect(
      applicationService.transfer(recruiter, refreshed, { position_id: 0 }),
    ).rejects.toBeInstanceOf(UnprocessableEntityError);
    await expect(
      applicationService.transfer(recruiter, refreshed, { position_id: 9_999_999 }),
    ).rejects.toBeInstanceOf(UnprocessableEntityError);

    const closed = await Position.create({
      user_id: null,
      department_id: 1,
      grade_id: 1,
      name: `Transfer Closed ${Date.now()}`,
      description: "closed",
      hiring: false,
      start_date: null,
      end_date: null,
    });
    await expect(
      applicationService.transfer(recruiter, refreshed, { position_id: Number(closed.id) }),
    ).rejects.toBeInstanceOf(UnprocessableEntityError);

    const otherDepartment = await departmentService.create(`Transfer Other ${Date.now()}`);
    const foreignSeat = await Position.create({
      user_id: null,
      department_id: otherDepartment.id,
      grade_id: 1,
      name: `Foreign Seat ${Date.now()}`,
      description: "other team",
      hiring: true,
      start_date: null,
      end_date: null,
    });
    await expect(
      applicationService.transfer(recruiter, refreshed, { position_id: Number(foreignSeat.id) }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const frozenDepartment = await departmentService.create(`Transfer Freeze ${Date.now()}`);
    const frozenSeat = await Position.create({
      user_id: null,
      department_id: frozenDepartment.id,
      grade_id: 1,
      name: `Frozen Seat ${Date.now()}`,
      description: "frozen",
      hiring: true,
      start_date: null,
      end_date: null,
    });
    await departmentService.freeze(admin, frozenDepartment.id);
    await expect(
      applicationService.transfer(admin, refreshed, { position_id: Number(frozenSeat.id) }),
    ).rejects.toBeInstanceOf(UnprocessableEntityError);

    const duplicateSeat = await unusedHiringPosition(candidate.id);
    const duplicate = await Application.create({
      user_id: candidate.id,
      position_id: Number(duplicateSeat.id),
      status_id: STATUS.APPLIED,
      attachment_text: null,
      attachment_file: null,
    });
    await expect(
      applicationService.transfer(recruiter, refreshed, { position_id: Number(duplicateSeat.id) }),
    ).rejects.toBeInstanceOf(ConflictError);
    await duplicate.delete();
    await expect(
      applicationService.transfer(recruiter, refreshed, { position_id: Number(duplicateSeat.id) }),
    ).rejects.toBeInstanceOf(ConflictError);

    const target = await unusedHiringPosition(candidate.id);
    const moved = await applicationService.transfer(recruiter, refreshed, {
      position_id: Number(target.id),
    });
    expect(Number(moved.get("position_id"))).toBe(Number(target.id));
    expect(Number(moved.get("status_id"))).toBe(STATUS.IN_PROGRESS);

    const adminTarget = await Position.create({
      user_id: null,
      department_id: otherDepartment.id,
      grade_id: 1,
      name: `Admin Target ${Date.now()}`,
      description: "admin transfer",
      hiring: true,
      start_date: null,
      end_date: null,
    });
    const adminMoved = await applicationService.transfer(
      admin,
      await Application.findOrFail(moved.id),
      { position_id: Number(adminTarget.id) },
    );
    expect(Number(adminMoved.get("position_id"))).toBe(Number(adminTarget.id));
    expect(Number(adminMoved.get("status_id"))).toBe(STATUS.IN_PROGRESS);

    const httpSource = await unusedHiringPosition(candidate.id);
    const extra = await users.create({
      first_name: "Transfer",
      last_name: "Http",
      email: `transfer.http.${Date.now()}@hiroapp.com`,
      password: await hashPassword("password"),
      role_id: ROLE.CANDIDATE,
    });
    const httpApp = await applicationService.apply(extra, {
      position_id: Number(httpSource.id),
      attachment_text: "http",
      attachment_file: null,
    });
    const httpTarget = await unusedHiringPosition(extra.id);
    const forbidden = await jsonRequest(`/api/applications/${httpApp.id}/transfer`, {
      cookies: candidateCookies,
      method: "POST",
      body: JSON.stringify({ position_id: Number(httpTarget.id) }),
    });
    expect(forbidden.response.status).toBe(403);
    const invalid = await jsonRequest(`/api/applications/${httpApp.id}/transfer`, {
      cookies: recruiterCookies,
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(invalid.response.status).toBe(422);
    const httpOk = await jsonRequest(`/api/applications/${httpApp.id}/transfer`, {
      cookies: recruiterCookies,
      method: "POST",
      body: JSON.stringify({ position_id: Number(httpTarget.id) }),
    });
    expect(httpOk.response.status).toBe(200);
    expect(Number(httpOk.body.position_id)).toBe(Number(httpTarget.id));
    expect(Number(httpOk.body.status_id)).toBe(STATUS.APPLIED);

    const htmlSource = await unusedHiringPosition(extra.id);
    const htmlApp = await applicationService.apply(extra, {
      position_id: Number(htmlSource.id),
      attachment_text: "html",
      attachment_file: null,
    });
    const htmlTarget = await unusedHiringPosition(extra.id);
    const page = await request(`/applications/${htmlApp.id}`, { cookies: recruiterCookies });
    expect(page.response.status).toBe(200);
    expect(page.text).toContain("Transfer application");
    const html = await request(`/applications/${htmlApp.id}/transfer`, {
      cookies: page.cookies,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-csrf-token": csrfFrom(page.cookies),
      },
      body: `position_id=${Number(htmlTarget.id)}`,
    });
    expect([302, 303].includes(html.response.status)).toBe(true);
    expect(Number((await Application.findOrFail(htmlApp.id)).get("position_id"))).toBe(
      Number(htmlTarget.id),
    );
  });
});
