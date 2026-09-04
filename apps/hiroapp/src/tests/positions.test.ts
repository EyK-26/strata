import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { hashPassword } from "@getstrata/core/auth/password";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnprocessableEntityError,
  ValidationError,
} from "@getstrata/core/errors/http";
import { GRADE, ROLE } from "../lib/roles.ts";
import { Position } from "../models/Position.ts";
import { departments } from "../modules/departments/repository.ts";
import { positionService, shouldCloseExpiredSeat } from "../modules/positions/service.ts";
import { departmentMembers } from "../modules/teams/memberRepository.ts";
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

describe.skipIf(!enabled)("Wave 15 position service", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl = "";
  let recruiterCookies: string[] = [];
  let adminCookies: string[] = [];
  let candidateCookies: string[] = [];

  beforeAll(async () => {
    const boot = await bootHiroapp();
    server = boot.server;
    baseUrl = boot.baseUrl;
    recruiterCookies = (await signInCookie("recruiter@hiroapp.com")).cookies;
    adminCookies = (await signInCookie("admin@hiroapp.com")).cookies;
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

  test("shouldCloseExpiredSeat covers date branches", () => {
    const now = new Date("2026-09-04T00:00:00Z");
    expect(shouldCloseExpiredSeat(null, now)).toBe(false);
    expect(shouldCloseExpiredSeat("", now)).toBe(false);
    expect(shouldCloseExpiredSeat("not-a-date", now)).toBe(false);
    expect(shouldCloseExpiredSeat(new Date("2026-09-05"), now)).toBe(false);
    expect(shouldCloseExpiredSeat(new Date("2026-09-03"), now)).toBe(true);
    expect(shouldCloseExpiredSeat("2026-09-01T00:00:00Z", now)).toBe(true);
  });

  test("staff create, update, close, reopen, expire, and delete seats", async () => {
    const candidate = await seededUser("candidate@hiroapp.com");
    const recruiter = await seededUser("recruiter@hiroapp.com");
    const admin = await seededUser("admin@hiroapp.com");

    await expect(
      positionService.create(candidate, {
        name: "Nope",
        description: null,
        start_date: null,
        end_date: null,
        pay_grade: GRADE.LOW,
        department_id: 1,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      positionService.create(admin, {
        name: "   ",
        description: null,
        start_date: null,
        end_date: null,
        pay_grade: GRADE.LOW,
        department_id: 1,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      positionService.create(admin, {
        name: "Bad grade",
        description: null,
        start_date: null,
        end_date: null,
        pay_grade: 9,
        department_id: 1,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      positionService.create(admin, {
        name: "No department",
        description: null,
        start_date: null,
        end_date: null,
        pay_grade: GRADE.LOW,
        department_id: 0,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      positionService.create(admin, {
        name: "Missing department",
        description: null,
        start_date: null,
        end_date: null,
        pay_grade: GRADE.LOW,
        department_id: 9_999_999,
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityError);
    await expect(
      positionService.create(admin, {
        name: "Bad date",
        description: null,
        start_date: "not-a-date",
        end_date: null,
        pay_grade: GRADE.LOW,
        department_id: 1,
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    const created = await positionService.create(admin, {
      name: `Wave15 Seat ${Date.now()}`,
      description: "  ",
      start_date: "2026-09-10",
      end_date: "",
      pay_grade: GRADE.MEDIUM,
      department_id: 1,
    });
    expect(Boolean(created.hiring)).toBe(true);
    expect(created.description).toBeNull();
    expect(Number(created.grade_id)).toBe(GRADE.MEDIUM);

    const recruiterSeat = await positionService.create(recruiter, {
      name: `Wave15 Recruiter ${Date.now()}`,
      description: "panel",
      start_date: null,
      end_date: null,
      pay_grade: GRADE.HIGH,
      department_id: 9_999_999,
    });
    expect(Number(recruiterSeat.department_id)).toBe(1);

    const model = await Position.findOrFail(created.id);
    await expect(positionService.update(candidate, model, { name: "x" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(positionService.update(admin, model, { name: "   " })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(positionService.update(admin, model, { pay_grade: 8 })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(
      positionService.update(admin, model, { end_date: "not-a-date" }),
    ).rejects.toBeInstanceOf(ValidationError);

    const unchanged = await positionService.update(admin, model, {});
    expect(unchanged.id).toBe(created.id);

    const updated = await positionService.update(admin, await Position.findOrFail(created.id), {
      name: `Wave15 Renamed ${Date.now()}`,
      description: "  notes  ",
      pay_grade: GRADE.HIGH,
      start_date: "",
      end_date: "2026-12-01",
    });
    expect(Number(updated.grade_id)).toBe(GRADE.HIGH);
    expect(updated.description).toBe("notes");

    const ghost = Position.newFromRecord({
      id: 9_999_999,
      user_id: null,
      department_id: 1,
      grade_id: 1,
      name: "Ghost",
      description: null,
      hiring: true,
      start_date: null,
      end_date: null,
      created_at: null,
      updated_at: null,
      deleted_at: null,
    });
    await expect(positionService.update(admin, ghost, { name: "Ghosted" })).rejects.toBeInstanceOf(
      NotFoundError,
    );

    const closed = await positionService.close(admin, await Position.findOrFail(created.id));
    expect(Boolean(closed.get("hiring"))).toBe(false);
    await expect(
      positionService.close(admin, await Position.findOrFail(created.id)),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const reopened = await positionService.reopen(admin, await Position.findOrFail(created.id));
    expect(Boolean(reopened.get("hiring"))).toBe(true);
    await expect(
      positionService.reopen(admin, await Position.findOrFail(created.id)),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const occupiedOwner = await users.create({
      first_name: "Seat",
      last_name: "Holder",
      email: `occupied.positions.${Date.now()}@hiroapp.com`,
      password: await hashPassword("password"),
      role_id: ROLE.CANDIDATE,
    });
    const occupied = await Position.create({
      user_id: occupiedOwner.id,
      department_id: 1,
      grade_id: 1,
      name: `Occupied ${Date.now()}`,
      description: null,
      hiring: false,
      start_date: null,
      end_date: null,
    });
    await expect(
      positionService.reopen(admin, await Position.findOrFail(occupied.id)),
    ).rejects.toBeInstanceOf(ConflictError);

    const future = await Position.create({
      user_id: null,
      department_id: 1,
      grade_id: 1,
      name: `Future ${Date.now()}`,
      description: null,
      hiring: true,
      start_date: null,
      end_date: new Date("2099-01-01"),
    });
    const openEnded = await Position.create({
      user_id: null,
      department_id: 1,
      grade_id: 1,
      name: `Open ended ${Date.now()}`,
      description: null,
      hiring: true,
      start_date: null,
      end_date: null,
    });
    const expired = await Position.create({
      user_id: null,
      department_id: 1,
      grade_id: 1,
      name: `Expired ${Date.now()}`,
      description: null,
      hiring: true,
      start_date: null,
      end_date: new Date("2020-01-01"),
    });
    const expiredCount = await positionService.closeExpired(new Date("2020-01-02"));
    expect(expiredCount).toBeGreaterThanOrEqual(1);
    expect(Boolean((await Position.findOrFail(expired.id)).get("hiring"))).toBe(false);
    expect(Boolean((await Position.findOrFail(future.id)).get("hiring"))).toBe(true);
    expect(Boolean((await Position.findOrFail(openEnded.id)).get("hiring"))).toBe(true);

    await expect(
      positionService.remove(recruiter, await Position.findOrFail(recruiterSeat.id)),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const removed = await positionService.remove(
      admin,
      await Position.findOrFail(recruiterSeat.id),
    );
    expect(removed.deleted).toBe(true);
    await expect(positionService.restore(recruiter, ghost)).rejects.toBeInstanceOf(ForbiddenError);
    const trashed = await Position.onlyTrashed().where({ id: recruiterSeat.id }).first();
    expect(trashed).toBeTruthy();
    if (!trashed) {
      throw new Error("expected soft-deleted recruiter seat");
    }
    const restored = await positionService.restore(admin, trashed);
    expect(Number(restored.id)).toBe(recruiterSeat.id);

    expect(
      (await positionService.listHiringForActor(admin, { search: "Wave15" })).length,
    ).toBeGreaterThan(0);
    expect(
      (await positionService.listHiringForActor(admin, { department_id: 1 })).length,
    ).toBeGreaterThan(0);
    expect(
      (await positionService.listHiringForActor(recruiter, { search: "Wave15" })).length,
    ).toBeGreaterThan(0);
    expect((await positionService.listHiringForActor(candidate, {})).length).toBeGreaterThan(0);

    const orphan = await users.create({
      first_name: "Orphan",
      last_name: "Seats",
      email: `orphan.positions.${Date.now()}@hiroapp.com`,
      password: await hashPassword("password"),
      role_id: ROLE.RECRUITER,
      current_department_id: null,
    });
    await expect(positionService.listHiringForActor(orphan)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      positionService.create(orphan, {
        name: "No team",
        description: null,
        start_date: null,
        end_date: null,
        pay_grade: GRADE.LOW,
        department_id: 1,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const emptyTeam = await departments.create({ name: `Empty seats ${Date.now()}` });
    await departmentMembers.create({
      department_id: emptyTeam.id,
      user_id: orphan.id,
      role: "member",
    });
    await users.updateById(orphan.id, { current_department_id: emptyTeam.id });
    const refreshed = await users.findByIdOrThrow(orphan.id);
    expect(await positionService.listHiringForActor(refreshed)).toEqual([]);

    const httpCreate = await jsonRequest("/api/positions", {
      cookies: recruiterCookies,
      method: "POST",
      body: JSON.stringify({
        name: `Http Seat ${Date.now()}`,
        description: "http",
        pay_grade: 1,
        department_id: 1,
      }),
    });
    expect(httpCreate.response.status).toBe(200);
    expect(httpCreate.body.message).toBe("success");

    const listed = await jsonRequest("/api/positions?search=Http", { cookies: adminCookies });
    expect(listed.response.status).toBe(200);

    const httpUpdate = await jsonRequest(`/api/positions/${httpCreate.body.id}`, {
      cookies: adminCookies,
      method: "POST",
      body: JSON.stringify({ description: "updated" }),
    });
    expect(httpUpdate.response.status).toBe(200);

    const httpClose = await jsonRequest(`/api/positions/${httpCreate.body.id}/close`, {
      cookies: recruiterCookies,
      method: "POST",
    });
    expect(httpClose.body.hiring).toBe(0);

    const httpReopen = await jsonRequest(`/api/positions/${httpCreate.body.id}/reopen`, {
      cookies: recruiterCookies,
      method: "POST",
    });
    expect(httpReopen.body.hiring).toBe(1);

    const primedShow = await request(`/positions/${created.id}`, { cookies: adminCookies });
    const htmlClose = await request(`/positions/${created.id}/close`, {
      cookies: primedShow.cookies,
      method: "POST",
      headers: { "x-csrf-token": csrfFrom(primedShow.cookies) },
    });
    expect([302, 303].includes(htmlClose.response.status)).toBe(true);

    const page = await request(`/positions/${created.id}`, { cookies: adminCookies });
    expect(page.text).toContain("Reopen hiring");
    expect(page.text).toContain("Delete position");

    const deleted = await jsonRequest(`/api/positions/${httpCreate.body.id}/delete`, {
      cookies: adminCookies,
      method: "POST",
    });
    expect(deleted.body.deleted).toBe(true);
    const httpRestore = await jsonRequest(`/api/positions/${httpCreate.body.id}/restore`, {
      cookies: adminCookies,
      method: "POST",
    });
    expect(httpRestore.body.restored).toBe(true);

    const forbiddenCreate = await jsonRequest("/api/positions", {
      cookies: candidateCookies,
      method: "POST",
      body: JSON.stringify({
        name: "Candidate seat",
        pay_grade: 1,
        department_id: 1,
      }),
    });
    expect(forbiddenCreate.response.status).toBe(403);
  });
});
