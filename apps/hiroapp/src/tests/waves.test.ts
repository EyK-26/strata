import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { FAILED_JOB_SERVICE_TOKEN } from "@getstrata/core/queue/createAppQueue";
import type FailedJobService from "@getstrata/core/queue/failedJobService";
import { STATUS } from "../lib/roles.ts";
import { Application } from "../models/Application.ts";
import type { Comment } from "../models/Comment.ts";
import { Department } from "../models/Department.ts";
import { Position } from "../models/Position.ts";
import { Skill } from "../models/Skill.ts";
import { User } from "../models/User.ts";
import { positions } from "../modules/positions/repository.ts";
import { skills } from "../modules/skills/repository.ts";
import { users } from "../modules/users/repository.ts";
import { applicationObserver } from "../observers/ApplicationObserver.ts";
import { closeExpiredPositions } from "../schedule.ts";
import { bootHiroapp, collectCookies, cookieHeader, csrfFrom, signInCookie } from "./helpers.ts";

const enabled = process.env.HIROAPP_TEST === "1";

describe.skipIf(!enabled)("Wave 2 model graph", () => {
  test("User.skills() and Position.skills() are belongsToMany with pivot values", async () => {
    const candidate = await users.findByEmail("candidate@hiroapp.com");
    const owned = await User.newFromRecord(candidate!).skills();
    expect(owned.length).toBeGreaterThan(0);
    expect(owned.some((row) => row.get("name") === "TypeScript")).toBe(true);

    const hiring = await positions.hiring();
    const attached = await Position.newFromRecord(hiring[0]!).skills();
    expect(attached.length).toBeGreaterThan(0);
  });

  test("watchlist toggle attaches and detaches a position", async () => {
    const candidate = await users.findByEmail("candidate@hiroapp.com");
    const hiring = await Position.where({ hiring: true }).first();
    expect(hiring).toBeTruthy();
    const query = User.newFromRecord(candidate!).watching();
    await query.toggle(hiring!.id);
    const watching = await User.newFromRecord(candidate!).watching();
    expect(watching.some((row) => Number(row.id) === Number(hiring!.id))).toBe(true);
    await User.newFromRecord(candidate!).watching().toggle(hiring!.id);
    const after = await User.newFromRecord(candidate!).watching();
    expect(after.some((row) => Number(row.id) === Number(hiring!.id))).toBe(false);
  });

  test("Department.applications() is hasManyThrough Position", async () => {
    const hiring = await positions.hiring();
    const department = await Department.find(Number(hiring[0]!.department_id));
    expect(department).toBeTruthy();
    const rows = await department!.applications();
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toBeInstanceOf(Application);
  });

  test("comments morphMany Application and Position; morphTo commentable", async () => {
    const candidate = await users.findByEmail("candidate@hiroapp.com");
    const apps = await User.newFromRecord(candidate!).applications();
    const created = await apps[0]!.comments().create({
      user_id: candidate!.id,
      body: "wave-2 comment",
    });
    expect(created.get("commentable_type")).toBe("App\\Models\\Application");
    expect(Number(created.get("commentable_id"))).toBe(Number(apps[0]!.id));
    const parent = await (created as Comment).commentable();
    expect(parent).toBeInstanceOf(Application);
    await created.delete();
  });

  test("soft delete withdraws an application and restore brings it back", async () => {
    const candidate = await users.findByEmail("candidate@hiroapp.com");
    const hiring = await Position.where({ hiring: true }).first();
    const created = await User.newFromRecord(candidate!).applications().create({
      position_id: hiring!.id,
      status_id: STATUS.APPLIED,
      attachment_text: "soft-delete",
      attachment_file: null,
    });
    await created.delete();
    expect(await Application.find(created.id)).toBeNull();
    const trashed = await Application.onlyTrashed().where({ id: created.id }).first();
    expect(trashed).toBeTruthy();
    await trashed!.restore();
    expect(await Application.find(created.id)).toBeTruthy();
    await Application.findOrFail(created.id).then((row) => row.delete());
  });

  test("interview panel syncs belongsToMany users", async () => {
    const recruiter = await users.findByEmail("recruiter@hiroapp.com");
    const hiring = await Position.where({ hiring: true }).first();
    const position = Position.newFromRecord(hiring!);
    await position.interviewers().withPivotValues({ role: "panel" }).sync([recruiter!.id]);
    const panel = await position.interviewers();
    expect(panel.some((row) => Number(row.id) === recruiter!.id)).toBe(true);
  });
});

describe.skipIf(!enabled)("Wave 4 observers, schedule, chunk", () => {
  test("creating an application emits ApplicationSubmitted and notifies the candidate", async () => {
    Application.observe(applicationObserver);
    await import("../listeners/sendApplicationSubmitted.ts");
    const candidate = await users.findByEmail("candidate@hiroapp.com");
    const hiring = await Position.where({ hiring: true }).first();
    const before = ((await User.newFromRecord(candidate!).notifications()) as { id: string }[])
      .length;
    const created = await User.newFromRecord(candidate!).applications().create({
      position_id: hiring!.id,
      status_id: STATUS.APPLIED,
      attachment_text: "observer",
      attachment_file: null,
    });
    const after = ((await User.newFromRecord(candidate!).notifications()) as { id: string }[])
      .length;
    expect(after).toBeGreaterThan(before);
    await created.delete();
  });

  test("closeExpiredPositions flips hiring false when end_date is past", async () => {
    const created = await Position.create({
      user_id: null,
      department_id: 1,
      grade_id: 1,
      name: "Expired Parity Role",
      description: "closed by schedule",
      hiring: true,
      start_date: null,
      end_date: new Date("2020-01-01"),
    });
    const closed = await closeExpiredPositions(new Date("2020-01-02"));
    expect(closed).toBeGreaterThanOrEqual(1);
    const refreshed = await Position.find(created.id);
    expect(refreshed?.get("hiring")).toBe(false);
    await created.delete();
  });

  test("Application.chunk walks persisted rows", async () => {
    let seen = 0;
    await Application.chunk(10, async (batch) => {
      seen += batch.length;
    });
    expect(seen).toBeGreaterThan(0);
  });

  test("Skill catalog was seeded", async () => {
    const catalog = await skills.ordered();
    expect(catalog.map((row) => row.name)).toContain("TypeScript");
    expect(await Skill.where({ name: "React" }).first()).toBeTruthy();
  });
});

describe.skipIf(!enabled)("Waves 1-4 HTTP + HTMX", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl = "";
  let failedJobs: FailedJobService;
  let candidateCookies: string[] = [];
  let recruiterCookies: string[] = [];
  let adminCookies: string[] = [];

  beforeAll(async () => {
    const boot = await bootHiroapp();
    server = boot.server;
    baseUrl = boot.baseUrl;
    failedJobs = boot.context.container.resolve<FailedJobService>(FAILED_JOB_SERVICE_TOKEN);
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

  test("GET /api/applications includes JsonResource position when loaded", async () => {
    const { response, body } = await jsonRequest("/api/applications", {
      cookies: candidateCookies,
    });
    expect(response.status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data[0]?.position?.name).toBeTruthy();
  });

  test("candidate can sync skills and watch a position", async () => {
    const catalog = await jsonRequest("/api/skills", { cookies: candidateCookies });
    const skillId = Number(catalog.body.data[0].id);
    const synced = await jsonRequest("/api/me/skills", {
      cookies: candidateCookies,
      method: "POST",
      body: JSON.stringify({
        skills: [{ skill_id: skillId, years: 4, level: "advanced" }],
      }),
    });
    expect(synced.response.status).toBe(200);
    expect(synced.body.data.some((row: { id: number }) => Number(row.id) === skillId)).toBe(true);

    const hiring = await positions.hiring();
    const watched = await jsonRequest(`/api/positions/${hiring[0]!.id}/watch`, {
      cookies: candidateCookies,
      method: "POST",
    });
    expect(watched.response.status).toBe(200);
    const list = await jsonRequest("/api/me/watching", { cookies: candidateCookies });
    expect(list.body.some((row: { id: number }) => Number(row.id) === Number(hiring[0]!.id))).toBe(
      true,
    );
  });

  test("recruiter can list department applications via hasManyThrough", async () => {
    const hiring = await positions.hiring();
    const { response, body } = await jsonRequest(
      `/api/departments/${hiring[0]!.department_id}/applications`,
      { cookies: recruiterCookies },
    );
    expect(response.status).toBe(200);
    expect(body.count).toBeGreaterThan(0);
  });

  test("comments API creates a morph comment on an application", async () => {
    const candidate = await users.findByEmail("candidate@hiroapp.com");
    const apps = await User.newFromRecord(candidate!).applications();
    const created = await jsonRequest(`/api/applications/${apps[0]!.id}/comments`, {
      cookies: recruiterCookies,
      method: "POST",
      body: JSON.stringify({ body: "http comment" }),
    });
    expect(created.response.status).toBe(200);
    expect(created.body.body).toBe("http comment");
  });

  test("HTMX skills and watchlist pages render", async () => {
    const skillsPage = await request("/skills", { cookies: candidateCookies });
    expect(skillsPage.response.status).toBe(200);
    expect(skillsPage.text).toContain("Your skills");
    const watching = await request("/watching", { cookies: candidateCookies });
    expect(watching.response.status).toBe(200);
    expect(watching.text).toContain("Watchlist");
  });

  test("admin can list and retry failed jobs", async () => {
    const recorded = await failedJobs.recordFailure({
      jobName: "hiroapp-parity",
      payload: { ok: true },
      exception: "boom",
    });
    const list = await jsonRequest("/api/failed-jobs", { cookies: adminCookies });
    expect(list.response.status).toBe(200);
    expect(list.body.some((row: { id: number }) => Number(row.id) === Number(recorded.id))).toBe(
      true,
    );
    const retried = await jsonRequest(`/api/failed-jobs/${recorded.id}/retry`, {
      cookies: adminCookies,
      method: "POST",
    });
    expect(retried.response.status).toBe(200);
    expect(retried.body.retried).toBe(true);
  });

  test("export applications uses chunk", async () => {
    const exported = await jsonRequest("/api/export/applications", { cookies: recruiterCookies });
    expect(exported.response.status).toBe(200);
    expect(exported.body.count).toBeGreaterThan(0);
  });

  test("candidate home HTML includes applications", async () => {
    const home = await request("/", { cookies: candidateCookies });
    expect(home.response.status).toBe(200);
    expect(home.text).toContain("HiroApp");
  });
});
