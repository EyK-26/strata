import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { hashPassword } from "@getstrata/core/auth/password";
import { ForbiddenError, UnprocessableEntityError } from "@getstrata/core/errors/http";
import { ROLE, STATUS } from "../lib/roles.ts";
import { Application } from "../models/Application.ts";
import { OnboardingItem } from "../models/OnboardingItem.ts";
import { Position } from "../models/Position.ts";
import { onboardingService, serializeOnboardingItem } from "../modules/onboarding/service.ts";
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

describe.skipIf(!enabled)("Wave 35 onboarding checklist", () => {
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

  async function openApplication(userId: number, statusId = STATUS.HIRED) {
    const seat = await Position.create({
      user_id: null,
      department_id: 1,
      grade_id: 1,
      name: `Onboard Seat ${Date.now()}-${Math.random()}`,
      description: "onboarding",
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

  test("staff add checklist items on hired applications; owners complete them", async () => {
    const candidate = await seededUser("candidate@hiroapp.com");
    const recruiter = await seededUser("recruiter@hiroapp.com");
    const other = await users.create({
      first_name: "Other",
      last_name: "Hire",
      email: `other.onboard.${Date.now()}@hiroapp.com`,
      password: await hashPassword("password"),
      role_id: ROLE.CANDIDATE,
    });
    const hired = await openApplication(candidate.id);
    const applied = await openApplication(candidate.id, STATUS.APPLIED);

    expect(await onboardingService.listForApplication(recruiter, hired)).toEqual([]);
    await expect(onboardingService.listForApplication(other, hired)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      onboardingService.create(candidate, hired, { title: "Laptop" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      onboardingService.create(recruiter, applied, { title: "Laptop" }),
    ).rejects.toBeInstanceOf(UnprocessableEntityError);
    await expect(
      onboardingService.create(recruiter, hired, { title: "  " }),
    ).rejects.toBeInstanceOf(UnprocessableEntityError);

    const created = await onboardingService.create(recruiter, hired, {
      title: "  Laptop  ",
      notes: "  ship Mac  ",
    });
    expect(created.status).toBe("open");
    expect(created.title).toBe("Laptop");
    expect(created.notes).toBe("ship Mac");
    const model = await OnboardingItem.findOrFail(created.id);
    expect(serializeOnboardingItem(model).status).toBe("open");
    expect(serializeOnboardingItem({ ...created, status: "nope" as never }).status).toBe("open");
    expect((await hired.onboardingItems()).length).toBe(1);

    await expect(
      onboardingService.complete(other, await OnboardingItem.findOrFail(created.id)),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const done = await onboardingService.complete(
      candidate,
      await OnboardingItem.findOrFail(created.id),
    );
    expect(done.status).toBe("done");
    expect(done.completed_by).toBe(candidate.id);
    expect(done.completed_at).not.toBeNull();
    await expect(
      onboardingService.complete(recruiter, await OnboardingItem.findOrFail(created.id)),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const staffItem = await onboardingService.create(recruiter, hired, { title: "Badge" });
    const staffDone = await onboardingService.complete(
      recruiter,
      await OnboardingItem.findOrFail(staffItem.id),
    );
    expect(staffDone.completed_by).toBe(recruiter.id);
    expect(await onboardingService.listForApplication(candidate, hired)).toHaveLength(2);

    const httpApp = await openApplication(candidate.id);
    const forbidden = await jsonRequest(`/api/applications/${httpApp.id}/onboarding`, {
      cookies: candidateCookies,
      method: "POST",
      body: JSON.stringify({ title: "Laptop" }),
    });
    expect(forbidden.response.status).toBe(403);
    const listed = await jsonRequest(`/api/applications/${httpApp.id}/onboarding`, {
      cookies: recruiterCookies,
    });
    expect(listed.body).toEqual([]);
    const httpCreated = await jsonRequest(`/api/applications/${httpApp.id}/onboarding`, {
      cookies: recruiterCookies,
      method: "POST",
      body: JSON.stringify({ title: "Payroll", notes: "forms" }),
    });
    expect(httpCreated.body.status).toBe("open");
    const httpDone = await jsonRequest(`/api/onboarding/${httpCreated.body.id}/complete`, {
      cookies: candidateCookies,
      method: "POST",
    });
    expect(httpDone.body.status).toBe("done");

    const htmlApp = await openApplication(candidate.id);
    const page = await request(`/applications/${htmlApp.id}`, { cookies: recruiterCookies });
    expect(page.response.status).toBe(200);
    const htmlCreate = await request(`/applications/${htmlApp.id}/onboarding`, {
      cookies: page.cookies,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-csrf-token": csrfFrom(page.cookies),
      },
      body: `title=Keys&notes=office&return_to=/applications/${htmlApp.id}`,
    });
    expect([302, 303].includes(htmlCreate.response.status)).toBe(true);
    const htmlItems = await onboardingService.listForApplication(recruiter, htmlApp);
    const htmlItem = htmlItems[0];
    if (!htmlItem) {
      throw new Error("missing html onboarding item");
    }
    const candPage = await request(`/applications/${htmlApp.id}`, { cookies: candidateCookies });
    const htmlComplete = await request(`/onboarding/${htmlItem.id}/complete`, {
      cookies: candPage.cookies,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-csrf-token": csrfFrom(candPage.cookies),
      },
      body: `return_to=/applications/${htmlApp.id}`,
    });
    expect([302, 303].includes(htmlComplete.response.status)).toBe(true);
  });
});
