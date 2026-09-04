import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { hashPassword } from "@getstrata/core/auth/password";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnprocessableEntityError,
  ValidationError,
} from "@getstrata/core/errors/http";
import { ROLE, STATUS } from "../lib/roles.ts";
import { Application } from "../models/Application.ts";
import { Position } from "../models/Position.ts";
import { applicationService } from "../modules/applications/service.ts";
import { departments } from "../modules/departments/repository.ts";
import { departmentService } from "../modules/departments/service.ts";
import { positions } from "../modules/positions/repository.ts";
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

async function unusedHiringPosition(userId: number) {
  const applied = await Application.withTrashed().where({ user_id: userId }).get();
  const used = new Set(applied.map((row) => Number(row.get("position_id"))));
  const hiring = await Position.where({ hiring: true }).get();
  const open = hiring.find((row) => !used.has(Number(row.id)));
  if (open) {
    return open;
  }
  return Position.create({
    user_id: null,
    department_id: 1,
    grade_id: 1,
    name: `Pipeline Open ${Date.now()}`,
    description: "pipeline seat",
    hiring: true,
    start_date: null,
    end_date: null,
  });
}

describe.skipIf(!enabled)("Waves 11-12 hiring pipeline and departments", () => {
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

  test("staff pipeline lists department applications and candidate lists only own", async () => {
    const candidate = await seededUser("candidate@hiroapp.com");
    const own = await jsonRequest("/api/applications", { cookies: candidateCookies });
    expect(own.response.status).toBe(200);
    expect(own.body.data.every((row: { user_id: number }) => row.user_id === candidate.id)).toBe(
      true,
    );

    const recruiter = await jsonRequest("/api/applications", { cookies: recruiterCookies });
    expect(recruiter.response.status).toBe(200);
    expect(recruiter.body.data.length).toBeGreaterThan(0);
    expect(recruiter.body.data[0]?.user).toBeTruthy();

    const admin = await jsonRequest("/api/applications?status_id=1", { cookies: adminCookies });
    expect(admin.response.status).toBe(200);
    expect(
      admin.body.data.every(
        (row: { status_id: number }) => Number(row.status_id) === STATUS.APPLIED,
      ),
    ).toBe(true);

    const searched = await jsonRequest("/api/applications?search=Engineer", {
      cookies: candidateCookies,
    });
    expect(searched.response.status).toBe(200);

    const candidateStatus = await jsonRequest("/api/applications?status_id=1", {
      cookies: candidateCookies,
    });
    expect(candidateStatus.response.status).toBe(200);
    expect(
      candidateStatus.body.data.every(
        (row: { status_id: number }) => Number(row.status_id) === STATUS.APPLIED,
      ),
    ).toBe(true);

    const staffSearch = await jsonRequest("/api/applications?search=Engineer", {
      cookies: recruiterCookies,
    });
    expect(staffSearch.response.status).toBe(200);

    const filtered = await jsonRequest("/api/applications?department_id=1", {
      cookies: adminCookies,
    });
    expect(filtered.response.status).toBe(200);

    const summary = await jsonRequest("/api/pipeline/summary", { cookies: recruiterCookies });
    expect(summary.response.status).toBe(200);
    expect(summary.body.total).toBeGreaterThan(0);
    expect(typeof summary.body.applied).toBe("number");
  });

  test("recruiter home and pipeline HTML render counts", async () => {
    const home = await request("/", { cookies: recruiterCookies });
    expect(home.response.status).toBe(200);
    expect(home.text).toContain("Hiring pipeline");
    const page = await request("/applications", { cookies: recruiterCookies });
    expect(page.response.status).toBe(200);
    expect(page.text).toContain("Hiring pipeline");
    const candidatePage = await request("/applications", { cookies: candidateCookies });
    expect(candidatePage.text).toContain("Your Applications");
  });

  test("apply, withdraw restore, move, end, and department CRUD cover service branches", async () => {
    const candidate = await seededUser("candidate@hiroapp.com");
    const recruiter = await seededUser("recruiter@hiroapp.com");
    const admin = await seededUser("admin@hiroapp.com");

    await expect(
      applicationService.apply(recruiter, {
        position_id: 1,
        attachment_text: null,
        attachment_file: null,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      applicationService.apply(candidate, {
        position_id: 9_999_999,
        attachment_text: null,
        attachment_file: null,
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityError);

    const closed = await Position.create({
      user_id: null,
      department_id: 1,
      grade_id: 1,
      name: `Closed ${Date.now()}`,
      description: "not hiring",
      hiring: false,
      start_date: null,
      end_date: null,
    });
    await expect(
      applicationService.apply(candidate, {
        position_id: Number(closed.id),
        attachment_text: null,
        attachment_file: null,
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityError);

    const open = await unusedHiringPosition(candidate.id);
    const created = await applicationService.apply(candidate, {
      position_id: Number(open.id),
      attachment_text: "cover",
      attachment_file: null,
    });
    await expect(
      applicationService.apply(candidate, {
        position_id: Number(open.id),
        attachment_text: "again",
        attachment_file: null,
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    await created.delete();
    const restored = await applicationService.apply(candidate, {
      position_id: Number(open.id),
      attachment_text: "restored",
      attachment_file: "https://example.com/cv",
    });
    expect(Number(restored.get("status_id"))).toBe(STATUS.APPLIED);
    expect(restored.get("attachment_text")).toBe("restored");

    const moved = await applicationService.move(recruiter, restored);
    expect(Number(moved.get("status_id"))).toBe(STATUS.IN_PROGRESS);
    await applicationService.move(recruiter, await Application.findOrFail(restored.id));
    await applicationService.move(recruiter, await Application.findOrFail(restored.id));
    expect(Number((await Application.findOrFail(restored.id)).get("status_id"))).toBe(
      STATUS.FEEDBACK,
    );

    const siblingSeat = await Position.create({
      user_id: null,
      department_id: 1,
      grade_id: 1,
      name: `Hire Seat ${Date.now()}`,
      description: "hire",
      hiring: true,
      start_date: null,
      end_date: null,
    });
    const extraCandidate = await users.create({
      first_name: "Extra",
      last_name: "Applicant",
      email: `extra.pipeline.${Date.now()}@hiroapp.com`,
      password: await hashPassword("password"),
      role_id: ROLE.CANDIDATE,
    });
    const endedPeer = await users.create({
      first_name: "Ended",
      last_name: "Peer",
      email: `ended.pipeline.${Date.now()}@hiroapp.com`,
      password: await hashPassword("password"),
      role_id: ROLE.CANDIDATE,
    });
    const winner = await applicationService.apply(extraCandidate, {
      position_id: Number(siblingSeat.id),
      attachment_text: "win",
      attachment_file: null,
    });
    const loser = await Application.create({
      user_id: candidate.id,
      position_id: Number(siblingSeat.id),
      status_id: STATUS.IN_PROGRESS,
      attachment_text: "lose",
      attachment_file: null,
    });
    await Application.create({
      user_id: endedPeer.id,
      position_id: Number(siblingSeat.id),
      status_id: STATUS.ENDED,
      attachment_text: null,
      attachment_file: null,
    });
    const occupied = await Position.create({
      user_id: extraCandidate.id,
      department_id: 1,
      grade_id: 1,
      name: `Old Seat ${Date.now()}`,
      description: "occupied",
      hiring: false,
      start_date: null,
      end_date: null,
    });
    await winner.update({ status_id: STATUS.FEEDBACK });
    const hired = await applicationService.move(admin, await Application.findOrFail(winner.id));
    expect(Number(hired.get("status_id"))).toBe(STATUS.HIRED);
    expect((await positions.findById(Number(occupied.id)))?.user_id).toBeNull();
    expect(Number((await Application.findOrFail(loser.id)).get("status_id"))).toBe(STATUS.ENDED);

    await expect(applicationService.move(admin, hired)).rejects.toBeInstanceOf(ForbiddenError);

    const noSeat = await Application.create({
      user_id: candidate.id,
      position_id: null,
      status_id: STATUS.FEEDBACK,
      attachment_text: null,
      attachment_file: null,
    });
    await expect(applicationService.move(admin, noSeat)).rejects.toBeInstanceOf(
      UnprocessableEntityError,
    );

    const missingPosition = await Application.create({
      user_id: candidate.id,
      position_id: 9_999_999,
      status_id: STATUS.FEEDBACK,
      attachment_text: null,
      attachment_file: null,
    });
    await expect(applicationService.move(admin, missingPosition)).rejects.toBeInstanceOf(
      UnprocessableEntityError,
    );

    await expect(
      applicationService.end(recruiter, await Application.findOrFail(loser.id)),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const toEnd = await Application.create({
      user_id: extraCandidate.id,
      position_id: null,
      status_id: STATUS.APPLIED,
      attachment_text: null,
      attachment_file: null,
    });
    const ended = await applicationService.end(recruiter, toEnd);
    expect(Number(ended.get("status_id"))).toBe(STATUS.ENDED);
    await expect(applicationService.end(recruiter, ended)).rejects.toBeInstanceOf(ForbiddenError);

    const orphanApp = await Application.create({
      user_id: extraCandidate.id,
      position_id: 9_999_999,
      status_id: STATUS.APPLIED,
      attachment_text: null,
      attachment_file: null,
    });
    const candidateEnded = await applicationService.end(extraCandidate, orphanApp);
    expect(Number(candidateEnded.get("status_id"))).toBe(STATUS.ENDED);

    const ghostSibling = await Application.create({
      user_id: 9_999_999,
      position_id: Number(open.id),
      status_id: STATUS.IN_PROGRESS,
      attachment_text: null,
      attachment_file: null,
    });
    await restored.update({ status_id: STATUS.FEEDBACK });
    await applicationService.move(admin, await Application.findOrFail(restored.id));
    await ghostSibling.delete().catch(() => undefined);

    const odd = await Application.create({
      user_id: extraCandidate.id,
      position_id: null,
      status_id: 99,
      attachment_text: null,
      attachment_file: null,
    });
    const counts = await applicationService.summaryForActor(admin);
    expect(counts.total).toBeGreaterThan(0);
    await odd.delete();

    const emptyDept = await departmentService.create(`Empty ${Date.now()}`);
    await departmentService.rename(emptyDept.id, emptyDept.name);
    await expect(departmentService.create("")).rejects.toBeInstanceOf(ValidationError);
    await expect(departmentService.rename(emptyDept.id, "   ")).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(departmentService.create(emptyDept.name)).rejects.toBeInstanceOf(ConflictError);
    const other = await departmentService.create(`Other ${Date.now()}`);
    await expect(departmentService.rename(other.id, emptyDept.name)).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(departmentService.remove(9_999_999)).rejects.toBeInstanceOf(NotFoundError);
    await expect(departmentService.remove(1)).rejects.toBeInstanceOf(ConflictError);
    expect((await departmentService.remove(emptyDept.id)).deleted).toBe(true);
    await departmentService.remove(other.id);

    const createdDept = await jsonRequest("/api/departments", {
      cookies: adminCookies,
      method: "POST",
      body: JSON.stringify({ name: `Api Dept ${Date.now()}` }),
    });
    expect(createdDept.response.status).toBe(200);
    const renamed = await jsonRequest(`/api/departments/${createdDept.body.id}`, {
      cookies: adminCookies,
      method: "POST",
      body: JSON.stringify({ name: `Renamed ${Date.now()}` }),
    });
    expect(renamed.response.status).toBe(200);
    const deleted = await jsonRequest(`/api/departments/${createdDept.body.id}/delete`, {
      cookies: adminCookies,
      method: "POST",
    });
    expect(deleted.body.deleted).toBe(true);
    const forbidden = await jsonRequest("/api/departments", {
      cookies: recruiterCookies,
      method: "POST",
      body: JSON.stringify({ name: "Nope" }),
    });
    expect(forbidden.response.status).toBe(403);

    const html = await request("/departments", { cookies: adminCookies });
    expect(html.response.status).toBe(200);
    expect(html.text).toContain("Departments");
    const createPage = await request("/departments/create", { cookies: adminCookies });
    expect(createPage.response.status).toBe(200);

    const orphan = await users.create({
      first_name: "Orphan",
      last_name: "Recruiter",
      email: `orphan.pipeline.${Date.now()}@hiroapp.com`,
      password: await hashPassword("password"),
      role_id: ROLE.RECRUITER,
      current_department_id: null,
    });
    await expect(
      applicationService.listForActor(orphan, {}, { page: 1, perPage: 10 }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const emptyTeam = await departments.create({ name: `No Seats ${Date.now()}` });
    const { departmentMembers } = await import("../modules/teams/memberRepository.ts");
    await departmentMembers.create({
      department_id: emptyTeam.id,
      user_id: orphan.id,
      role: "member",
    });
    await users.updateById(orphan.id, { current_department_id: emptyTeam.id });
    const refreshed = await users.findByIdOrThrow(orphan.id);
    expect(await applicationService.listForActor(refreshed, {}, { page: 1, perPage: 10 })).toEqual(
      [],
    );
    expect((await applicationService.summaryForActor(refreshed)).total).toBe(0);
    const candidateSummary = await applicationService.summaryForActor(candidate);
    expect(candidateSummary.total).toBeGreaterThan(0);
    expect(
      await applicationService.listForActor(
        admin,
        { department_id: emptyTeam.id },
        {
          page: 1,
          perPage: 10,
        },
      ),
    ).toEqual([]);
  });
});
