import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { hashPassword } from "@getstrata/core/auth/password";
import {
  ConflictError,
  ForbiddenError,
  UnprocessableEntityError,
  ValidationError,
} from "@getstrata/core/errors/http";
import { ROLE, STATUS } from "../lib/roles.ts";
import { Application } from "../models/Application.ts";
import { Position } from "../models/Position.ts";
import { TalentPoolEntry } from "../models/TalentPoolEntry.ts";
import { User } from "../models/User.ts";
import { inboxService } from "../modules/notifications/inbox.ts";
import { serializePoolEntry, talentPoolService } from "../modules/pool/service.ts";
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

describe.skipIf(!enabled)("Wave 31 talent pool", () => {
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

  async function openSeat() {
    return Position.create({
      user_id: null,
      department_id: 1,
      grade_id: 1,
      name: `Pool Seat ${Date.now()}-${Math.random()}`,
      description: "talent-pool",
      hiring: true,
      start_date: null,
      end_date: null,
    });
  }

  async function makeCandidate(label: string) {
    return users.create({
      first_name: "Pool",
      last_name: label,
      email: `pool.${label}.${Date.now()}@hiroapp.com`,
      password: await hashPassword("password"),
      role_id: ROLE.CANDIDATE,
    });
  }

  test("staff keep candidates in the talent pool and can release them", async () => {
    const candidate = await makeCandidate("keep");
    const recruiter = await seededUser("recruiter@hiroapp.com");
    const seededCandidate = await seededUser("candidate@hiroapp.com");
    const seat = await openSeat();
    const application = await Application.create({
      user_id: candidate.id,
      position_id: Number(seat.id),
      status_id: STATUS.ENDED,
      attachment_text: null,
      attachment_file: null,
    });
    const otherSeat = await openSeat();
    const otherApp = await Application.create({
      user_id: seededCandidate.id,
      position_id: Number(otherSeat.id),
      status_id: STATUS.APPLIED,
      attachment_text: null,
      attachment_file: null,
    });

    await expect(talentPoolService.list(candidate)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      talentPoolService.add(candidate, { user_id: candidate.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(talentPoolService.add(recruiter, { user_id: 9_999_999 })).rejects.toBeInstanceOf(
      UnprocessableEntityError,
    );
    await expect(
      talentPoolService.add(recruiter, { user_id: recruiter.id }),
    ).rejects.toBeInstanceOf(UnprocessableEntityError);
    await expect(
      talentPoolService.add(recruiter, {
        user_id: candidate.id,
        application_id: 9_999_999,
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityError);
    await expect(
      talentPoolService.add(recruiter, {
        user_id: candidate.id,
        application_id: Number(otherApp.id),
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityError);

    expect(await talentPoolService.forApplication(recruiter, application)).toBeNull();
    expect(
      serializePoolEntry({
        id: 1,
        user_id: 2,
        created_by: 3,
        source_application_id: null,
        notes: null,
        status: "nope" as never,
        created_at: null,
        updated_at: null,
      }).status,
    ).toBe("active");

    const created = await talentPoolService.add(recruiter, {
      user_id: candidate.id,
      notes: "  strong closer  ",
      application_id: Number(application.id),
    });
    expect(created.status).toBe("active");
    expect(created.notes).toBe("strong closer");
    expect(created.source_application_id).toBe(Number(application.id));
    const model = await TalentPoolEntry.findOrFail(created.id);
    expect(serializePoolEntry(model).status).toBe("active");
    expect(
      (await User.findOrFail(candidate.id).then((row) => row.talentPoolEntries())).length,
    ).toBe(1);
    await expect(
      talentPoolService.add(recruiter, { user_id: candidate.id }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(await talentPoolService.forApplication(recruiter, application)).toMatchObject({
      id: created.id,
      status: "active",
    });

    await expect(
      talentPoolService.release(candidate, await TalentPoolEntry.findOrFail(created.id)),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const released = await talentPoolService.release(
      recruiter,
      await TalentPoolEntry.findOrFail(created.id),
    );
    expect(released.status).toBe("released");
    await expect(
      talentPoolService.release(recruiter, await TalentPoolEntry.findOrFail(created.id)),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const reactivated = await talentPoolService.addFromApplication(recruiter, application, {
      notes: "try again next quarter",
    });
    expect(reactivated.id).toBe(created.id);
    expect(reactivated.status).toBe("active");
    expect(reactivated.notes).toBe("try again next quarter");

    const blank = await talentPoolService.add(recruiter, {
      user_id: (await makeCandidate("blank")).id,
      application_id: 0,
      notes: "   ",
    });
    expect(blank.source_application_id).toBeNull();
    expect(blank.notes).toBeNull();

    const listed = await talentPoolService.list(recruiter);
    expect(listed.some((row) => row.id === created.id && row.status === "active")).toBe(true);

    const httpCandidate = await makeCandidate("http");
    const forbiddenList = await jsonRequest("/api/talent-pool", { cookies: candidateCookies });
    expect(forbiddenList.response.status).toBe(403);
    const missing = await jsonRequest("/api/talent-pool", {
      cookies: recruiterCookies,
      method: "POST",
      body: JSON.stringify({ user_id: 9_999_999 }),
    });
    expect(missing.response.status).toBe(422);
    const httpCreated = await jsonRequest("/api/talent-pool", {
      cookies: recruiterCookies,
      method: "POST",
      body: JSON.stringify({ user_id: httpCandidate.id, notes: "keep" }),
    });
    expect(httpCreated.response.status).toBe(200);
    expect(httpCreated.body.status).toBe("active");
    const listedHttp = await jsonRequest("/api/talent-pool", { cookies: recruiterCookies });
    expect(listedHttp.body.some((row: { id: number }) => row.id === httpCreated.body.id)).toBe(
      true,
    );
    const httpSeat = await openSeat();
    const httpApp = await Application.create({
      user_id: seededCandidate.id,
      position_id: Number(httpSeat.id),
      status_id: STATUS.ENDED,
      attachment_text: null,
      attachment_file: null,
    });
    const before = await jsonRequest(`/api/applications/${httpApp.id}/talent-pool`, {
      cookies: recruiterCookies,
    });
    expect(before.body).toBeNull();
    const fromApp = await jsonRequest(`/api/applications/${httpApp.id}/talent-pool`, {
      cookies: recruiterCookies,
      method: "POST",
      body: JSON.stringify({ notes: "from application" }),
    });
    expect(fromApp.body.status).toBe("active");
    expect(fromApp.body.source_application_id).toBe(Number(httpApp.id));
    const releasedHttp = await jsonRequest(`/api/talent-pool/${httpCreated.body.id}/release`, {
      cookies: recruiterCookies,
      method: "POST",
    });
    expect(releasedHttp.body.status).toBe("released");

    const htmlCandidate = await makeCandidate("html");
    const primed = await request("/talent-pool", { cookies: recruiterCookies });
    expect(primed.response.status).toBe(200);
    expect(primed.text.includes("Talent pool")).toBe(true);
    const htmlAdd = await request("/talent-pool", {
      cookies: primed.cookies,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-csrf-token": csrfFrom(primed.cookies),
      },
      body: `user_id=${htmlCandidate.id}&notes=html+keep`,
    });
    expect([302, 303].includes(htmlAdd.response.status)).toBe(true);
    const htmlListed = await talentPoolService.list(recruiter);
    const htmlEntry = htmlListed.find((row) => row.user_id === htmlCandidate.id);
    if (!htmlEntry) {
      throw new Error("missing html pool entry");
    }
    const releasePage = await request("/talent-pool", { cookies: recruiterCookies });
    const htmlRelease = await request(`/talent-pool/${htmlEntry.id}/release`, {
      cookies: releasePage.cookies,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-csrf-token": csrfFrom(releasePage.cookies),
      },
      body: "return_to=/talent-pool",
    });
    expect([302, 303].includes(htmlRelease.response.status)).toBe(true);

    const htmlAppSeat = await openSeat();
    const htmlApp = await Application.create({
      user_id: htmlCandidate.id,
      position_id: Number(htmlAppSeat.id),
      status_id: STATUS.ENDED,
      attachment_text: null,
      attachment_file: null,
    });
    const appPage = await request(`/applications/${htmlApp.id}`, { cookies: recruiterCookies });
    expect(appPage.response.status).toBe(200);
    const htmlFromApp = await request(`/applications/${htmlApp.id}/talent-pool`, {
      cookies: appPage.cookies,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-csrf-token": csrfFrom(appPage.cookies),
      },
      body: `notes=keep+from+html&return_to=/applications/${htmlApp.id}`,
    });
    expect([302, 303].includes(htmlFromApp.response.status)).toBe(true);
  });

  test("staff reach out to an active talent-pool candidate", async () => {
    const candidate = await makeCandidate("outreach");
    const recruiter = await seededUser("recruiter@hiroapp.com");
    const created = await talentPoolService.add(recruiter, { user_id: candidate.id });

    await expect(
      talentPoolService.reachOut(candidate, await TalentPoolEntry.findOrFail(created.id), {
        text: "hello",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      talentPoolService.reachOut(recruiter, await TalentPoolEntry.findOrFail(created.id), {
        text: "   ",
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    const sent = await talentPoolService.reachOut(
      recruiter,
      await TalentPoolEntry.findOrFail(created.id),
      { text: "We have a new seat." },
    );
    expect(sent.sent).toBe(true);
    expect(sent.subject).toBe("Talent pool outreach");
    const inbox = await inboxService.list(candidate);
    expect(
      inbox.some((row) => {
        const data = row.get("data") as { subject?: string; text?: string };
        return data?.subject === "Talent pool outreach" && data?.text === "We have a new seat.";
      }),
    ).toBe(true);

    const named = await talentPoolService.reachOut(
      recruiter,
      await TalentPoolEntry.findOrFail(created.id),
      { subject: "  Next role  ", text: "Are you free next month?" },
    );
    expect(named.subject).toBe("Next role");

    await talentPoolService.release(recruiter, await TalentPoolEntry.findOrFail(created.id));
    await expect(
      talentPoolService.reachOut(recruiter, await TalentPoolEntry.findOrFail(created.id), {
        text: "too late",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const httpCandidate = await makeCandidate("http-out");
    const httpEntry = await talentPoolService.add(recruiter, { user_id: httpCandidate.id });
    const forbiddenHttp = await jsonRequest(`/api/talent-pool/${httpEntry.id}/reach-out`, {
      cookies: candidateCookies,
      method: "POST",
      body: JSON.stringify({ text: "nope" }),
    });
    expect(forbiddenHttp.response.status).toBe(403);
    const httpOk = await jsonRequest(`/api/talent-pool/${httpEntry.id}/reach-out`, {
      cookies: recruiterCookies,
      method: "POST",
      body: JSON.stringify({ subject: "HTTP outreach", text: "Please apply." }),
    });
    expect(httpOk.response.status).toBe(200);
    expect(httpOk.body.sent).toBe(true);
    expect(httpOk.body.subject).toBe("HTTP outreach");
    const missingText = await jsonRequest(`/api/talent-pool/${httpEntry.id}/reach-out`, {
      cookies: recruiterCookies,
      method: "POST",
      body: JSON.stringify({ subject: "empty" }),
    });
    expect(missingText.response.status).toBe(422);

    const htmlCandidate = await makeCandidate("html-out");
    const htmlEntry = await talentPoolService.add(recruiter, { user_id: htmlCandidate.id });
    const page = await request("/talent-pool", { cookies: recruiterCookies });
    expect(page.response.status).toBe(200);
    expect(page.text).toContain("Reach out");
    const html = await request(`/talent-pool/${htmlEntry.id}/reach-out`, {
      cookies: page.cookies,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-csrf-token": csrfFrom(page.cookies),
      },
      body: `subject=HTML+outreach&text=Come+back&return_to=/talent-pool`,
    });
    expect([302, 303].includes(html.response.status)).toBe(true);
    const htmlInbox = await inboxService.list(htmlCandidate);
    expect(
      htmlInbox.some((row) => {
        const data = row.get("data") as { subject?: string };
        return data?.subject === "HTML outreach";
      }),
    ).toBe(true);
  });

  test("staff add a candidate to the talent pool from their profile", async () => {
    const profile = await makeCandidate("profile");
    const recruiter = await seededUser("recruiter@hiroapp.com");

    const forbidden = await jsonRequest(`/api/users/${profile.id}/talent-pool`, {
      cookies: candidateCookies,
      method: "POST",
      body: JSON.stringify({ notes: "nope" }),
    });
    expect(forbidden.response.status).toBe(403);

    const httpCreated = await jsonRequest(`/api/users/${profile.id}/talent-pool`, {
      cookies: recruiterCookies,
      method: "POST",
      body: JSON.stringify({ notes: "from profile" }),
    });
    expect(httpCreated.response.status).toBe(200);
    expect(httpCreated.body.status).toBe("active");
    expect(httpCreated.body.user_id).toBe(profile.id);
    const conflict = await jsonRequest(`/api/users/${profile.id}/talent-pool`, {
      cookies: recruiterCookies,
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(conflict.response.status).toBe(409);

    const htmlCandidate = await makeCandidate("profile-html");
    const page = await request(`/users/${htmlCandidate.id}`, { cookies: recruiterCookies });
    expect(page.response.status).toBe(200);
    expect(page.text).toContain("Add to talent pool");
    const html = await request(`/users/${htmlCandidate.id}/talent-pool`, {
      cookies: page.cookies,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-csrf-token": csrfFrom(page.cookies),
      },
      body: `notes=html+profile&return_to=/users/${htmlCandidate.id}`,
    });
    expect([302, 303].includes(html.response.status)).toBe(true);
    const listed = await talentPoolService.list(recruiter);
    expect(listed.some((row) => row.user_id === htmlCandidate.id && row.status === "active")).toBe(
      true,
    );
    const after = await request(`/users/${htmlCandidate.id}`, { cookies: recruiterCookies });
    expect(after.text).toContain("In talent pool");
  });
});
