import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { hashPassword } from "@getstrata/core/auth/password";
import {
  ConflictError,
  ForbiddenError,
  UnprocessableEntityError,
} from "@getstrata/core/errors/http";
import { ROLE, STATUS } from "../lib/roles.ts";
import { Position } from "../models/Position.ts";
import { Referral } from "../models/Referral.ts";
import { applicationService } from "../modules/applications/service.ts";
import { referralService, serializeReferral } from "../modules/referrals/service.ts";
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

describe.skipIf(!enabled)("Wave 27 staff referrals", () => {
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
      name: `Referral Seat ${Date.now()}-${Math.random()}`,
      description: "referral",
      hiring: true,
      start_date: null,
      end_date: null,
    });
  }

  test("staff create and close referrals; applying marks an open referral", async () => {
    const candidate = await seededUser("candidate@hiroapp.com");
    const recruiter = await seededUser("recruiter@hiroapp.com");
    const seat = await openSeat();

    await expect(
      referralService.create(candidate, seat, { email: "a@b.co", name: "Pat" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      referralService.create(recruiter, seat, { email: "not-an-email", name: "Pat" }),
    ).rejects.toBeInstanceOf(UnprocessableEntityError);
    await expect(
      referralService.create(recruiter, seat, { email: "a@", name: "Pat" }),
    ).rejects.toBeInstanceOf(UnprocessableEntityError);
    await expect(
      referralService.create(recruiter, seat, { email: "pat@hiroapp.com", name: "  " }),
    ).rejects.toBeInstanceOf(UnprocessableEntityError);

    const created = await referralService.create(recruiter, seat, {
      email: "  Pat.Ref@HiroApp.com ",
      name: "  Pat  ",
      notes: "  ",
    });
    expect(created.email).toBe("pat.ref@hiroapp.com");
    expect(created.name).toBe("Pat");
    expect(created.notes).toBeNull();
    expect(created.status).toBe("open");
    expect(serializeReferral(created).email).toBe("pat.ref@hiroapp.com");
    expect(serializeReferral({ ...created, status: "nope" as never }).status).toBe("open");
    const model = await Referral.findOrFail(created.id);
    expect(serializeReferral(model).status).toBe("open");

    await expect(
      referralService.create(recruiter, seat, {
        email: "pat.ref@hiroapp.com",
        name: "Pat",
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    expect(await referralService.listForPosition(recruiter, seat)).toHaveLength(1);
    await expect(referralService.listForPosition(candidate, seat)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(
      (await referralService.listForReferrer(recruiter)).some((row) => row.id === created.id),
    ).toBe(true);
    await expect(referralService.listForReferrer(candidate)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await seat.referrals()).length).toBe(1);

    expect(await referralService.markApplied("nobody@hiroapp.com", Number(seat.id))).toBeNull();

    const applicant = await users.create({
      first_name: "Referred",
      last_name: "Applicant",
      email: `ref.apply.${Date.now()}@hiroapp.com`,
      password: await hashPassword("password"),
      role_id: ROLE.CANDIDATE,
    });
    const applySeat = await openSeat();
    const openReferral = await referralService.create(recruiter, applySeat, {
      email: applicant.email.toUpperCase(),
      name: "Referred Applicant",
      notes: "from staff",
    });
    const applied = await applicationService.apply(applicant, {
      position_id: Number(applySeat.id),
      attachment_text: "cover",
      attachment_file: null,
    });
    expect(Number(applied.get("status_id"))).toBe(STATUS.APPLIED);
    expect((await Referral.findOrFail(openReferral.id)).get("status")).toBe("applied");

    const closedFromApplied = await referralService.close(
      recruiter,
      await Referral.findOrFail(openReferral.id),
    );
    expect(closedFromApplied.status).toBe("closed");
    await expect(
      referralService.close(recruiter, await Referral.findOrFail(openReferral.id)),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      referralService.close(candidate, await Referral.findOrFail(created.id)),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const closedFromOpen = await referralService.close(
      recruiter,
      await Referral.findOrFail(created.id),
    );
    expect(closedFromOpen.status).toBe("closed");

    const httpSeat = await openSeat();
    const forbiddenCreate = await jsonRequest(`/api/positions/${httpSeat.id}/referrals`, {
      cookies: candidateCookies,
      method: "POST",
      body: JSON.stringify({ email: "http@hiroapp.com", name: "Http" }),
    });
    expect(forbiddenCreate.response.status).toBe(403);

    const httpCreated = await jsonRequest(`/api/positions/${httpSeat.id}/referrals`, {
      cookies: recruiterCookies,
      method: "POST",
      body: JSON.stringify({ email: "http.ref@hiroapp.com", name: "Http", notes: "api" }),
    });
    expect(httpCreated.response.status).toBe(200);
    expect(httpCreated.body.status).toBe("open");
    const listed = await jsonRequest(`/api/positions/${httpSeat.id}/referrals`, {
      cookies: recruiterCookies,
    });
    expect(listed.body.length).toBe(1);
    const mine = await jsonRequest("/api/referrals", { cookies: recruiterCookies });
    expect(mine.body.length).toBeGreaterThan(0);
    const closedHttp = await jsonRequest(`/api/referrals/${httpCreated.body.id}/close`, {
      cookies: recruiterCookies,
      method: "POST",
    });
    expect(closedHttp.body.status).toBe("closed");

    const htmlSeat = await openSeat();
    const primed = await request(`/positions/${htmlSeat.id}`, { cookies: recruiterCookies });
    const html = await request(`/positions/${htmlSeat.id}/referrals`, {
      cookies: primed.cookies,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-csrf-token": csrfFrom(primed.cookies),
      },
      body: "email=html.ref%40hiroapp.com&name=Html&notes=from-html",
    });
    expect([302, 303].includes(html.response.status)).toBe(true);
    const htmlList = await referralService.listForPosition(recruiter, htmlSeat);
    const htmlReferral = htmlList[0];
    if (!htmlReferral) {
      throw new Error("missing html referral");
    }
    const closePage = await request(`/positions/${htmlSeat.id}`, { cookies: recruiterCookies });
    const htmlClose = await request(`/referrals/${htmlReferral.id}/close`, {
      cookies: closePage.cookies,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-csrf-token": csrfFrom(closePage.cookies),
      },
      body: `return_to=/positions/${htmlSeat.id}`,
    });
    expect([302, 303].includes(htmlClose.response.status)).toBe(true);
  });
});
