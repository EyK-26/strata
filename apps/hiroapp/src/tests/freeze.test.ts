import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnprocessableEntityError,
} from "@getstrata/core/errors/http";
import { Position } from "../models/Position.ts";
import { applicationService } from "../modules/applications/service.ts";
import { careerService } from "../modules/careers/service.ts";
import { departmentService, serializeDepartment } from "../modules/departments/service.ts";
import { positionService } from "../modules/positions/service.ts";
import {
  bootHiroapp,
  collectCookies,
  cookieHeader,
  csrfFrom,
  seededUser,
  signInCookie,
} from "./helpers.ts";

const enabled = process.env.HIROAPP_TEST === "1";

describe.skipIf(!enabled)("Wave 42 department hiring freeze", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl = "";
  let adminCookies: string[] = [];
  let recruiterCookies: string[] = [];

  beforeAll(async () => {
    const boot = await bootHiroapp();
    server = boot.server;
    baseUrl = boot.baseUrl;
    adminCookies = (await signInCookie("admin@hiroapp.com")).cookies;
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

  test("admins freeze hiring; applies, seats, and career publish stop", async () => {
    const admin = await seededUser("admin@hiroapp.com");
    const recruiter = await seededUser("recruiter@hiroapp.com");
    const candidate = await seededUser("candidate@hiroapp.com");

    const department = await departmentService.create(`Freeze ${Date.now()}`);
    expect(serializeDepartment(department).hiring_frozen).toBe(false);
    await expect(departmentService.assertHiringOpen(9_999_999)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(departmentService.freeze(recruiter, department.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(departmentService.unfreeze(recruiter, department.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(departmentService.unfreeze(admin, department.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );

    const seat = await Position.create({
      user_id: null,
      department_id: department.id,
      grade_id: 1,
      name: `Freeze Seat ${Date.now()}`,
      description: "open",
      hiring: true,
      start_date: null,
      end_date: null,
    });

    const frozen = await departmentService.freeze(admin, department.id);
    expect(serializeDepartment(frozen).hiring_frozen).toBe(true);
    await expect(departmentService.freeze(admin, department.id)).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(departmentService.assertHiringOpen(department.id)).rejects.toBeInstanceOf(
      UnprocessableEntityError,
    );

    await expect(
      applicationService.apply(candidate, {
        position_id: Number(seat.id),
        attachment_text: null,
        attachment_file: null,
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityError);
    await expect(
      careerService.publish(admin, await Position.findOrFail(seat.id)),
    ).rejects.toBeInstanceOf(UnprocessableEntityError);
    await expect(
      positionService.create(admin, {
        name: `Blocked Seat ${Date.now()}`,
        description: null,
        start_date: null,
        end_date: null,
        pay_grade: 1,
        department_id: department.id,
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityError);

    await positionService.close(admin, await Position.findOrFail(seat.id));
    await expect(
      positionService.reopen(admin, await Position.findOrFail(seat.id)),
    ).rejects.toBeInstanceOf(UnprocessableEntityError);

    const thawed = await departmentService.unfreeze(admin, department.id);
    expect(serializeDepartment(thawed).hiring_frozen).toBe(false);
    await expect(departmentService.unfreeze(admin, department.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );

    await positionService.reopen(admin, await Position.findOrFail(seat.id));
    const applied = await applicationService.apply(candidate, {
      position_id: Number(seat.id),
      attachment_text: null,
      attachment_file: null,
    });
    expect(Number(applied.get("position_id"))).toBe(Number(seat.id));
    const opened = await positionService.create(admin, {
      name: `After Freeze ${Date.now()}`,
      description: null,
      start_date: null,
      end_date: null,
      pay_grade: 1,
      department_id: department.id,
    });
    expect(Number(opened.department_id)).toBe(Number(department.id));

    const httpDept = await departmentService.create(`Freeze Http ${Date.now()}`);
    const forbiddenHttp = await jsonRequest(`/api/departments/${httpDept.id}/freeze`, {
      cookies: recruiterCookies,
      method: "POST",
    });
    expect(forbiddenHttp.response.status).toBe(403);
    const httpFrozen = await jsonRequest(`/api/departments/${httpDept.id}/freeze`, {
      cookies: adminCookies,
      method: "POST",
    });
    expect(httpFrozen.body.hiring_frozen).toBe(true);
    const listed = await jsonRequest("/api/departments", { cookies: adminCookies });
    expect(listed.body.some((row: { id: number }) => row.id === httpDept.id)).toBe(true);
    const httpThawed = await jsonRequest(`/api/departments/${httpDept.id}/unfreeze`, {
      cookies: adminCookies,
      method: "POST",
    });
    expect(httpThawed.body.hiring_frozen).toBe(false);

    const htmlDept = await departmentService.create(`Freeze Html ${Date.now()}`);
    const page = await request("/departments", { cookies: adminCookies });
    expect(page.response.status).toBe(200);
    expect(page.text).toContain("Freeze hiring");
    const htmlFreeze = await request(`/departments/${htmlDept.id}/freeze`, {
      cookies: page.cookies,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-csrf-token": csrfFrom(page.cookies),
      },
      body: "return_to=/departments",
    });
    expect([302, 303].includes(htmlFreeze.response.status)).toBe(true);
    const frozenHtml = (await departmentService.ordered()).find((row) => row.id === htmlDept.id);
    if (!frozenHtml) {
      throw new Error("missing html freeze department");
    }
    expect(serializeDepartment(frozenHtml).hiring_frozen).toBe(true);
    const thawPage = await request("/departments", { cookies: adminCookies });
    expect(thawPage.text).toContain("Unfreeze hiring");
    const htmlThaw = await request(`/departments/${htmlDept.id}/unfreeze`, {
      cookies: thawPage.cookies,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-csrf-token": csrfFrom(thawPage.cookies),
      },
      body: "return_to=/departments",
    });
    expect([302, 303].includes(htmlThaw.response.status)).toBe(true);
  });
});
