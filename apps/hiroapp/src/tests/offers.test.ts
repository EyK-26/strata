import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { hashPassword } from "@getstrata/core/auth/password";
import {
  ConflictError,
  ForbiddenError,
  UnprocessableEntityError,
} from "@getstrata/core/errors/http";
import { ROLE, STATUS } from "../lib/roles.ts";
import { Application } from "../models/Application.ts";
import { Offer } from "../models/Offer.ts";
import { Position } from "../models/Position.ts";
import { offerService, serializeOffer } from "../modules/offers/service.ts";
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

describe.skipIf(!enabled)("Wave 25 application offers", () => {
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
      name: `Offer Seat ${Date.now()}-${Math.random()}`,
      description: "offer",
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

  test("staff draft and send offers; candidates accept or decline", async () => {
    const candidate = await seededUser("candidate@hiroapp.com");
    const recruiter = await seededUser("recruiter@hiroapp.com");
    const other = await users.create({
      first_name: "Other",
      last_name: "Applicant",
      email: `other.offer.${Date.now()}@hiroapp.com`,
      password: await hashPassword("password"),
      role_id: ROLE.CANDIDATE,
    });

    const application = await openApplication(candidate.id);
    const empty = await offerService.listForApplication(recruiter, application);
    expect(empty).toEqual([]);

    await expect(
      offerService.create(candidate, application, { salary: 100_000 }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(offerService.create(recruiter, application, { salary: 0 })).rejects.toBeInstanceOf(
      UnprocessableEntityError,
    );
    await expect(
      offerService.create(recruiter, application, { salary: 90_000, starts_on: "not-a-date" }),
    ).rejects.toBeInstanceOf(UnprocessableEntityError);

    const draft = await offerService.create(recruiter, application, {
      salary: 120_000,
      starts_on: "",
      notes: "  ",
    });
    expect(draft.status).toBe("draft");
    expect(draft.starts_on).toBeNull();
    expect(draft.notes).toBeNull();
    expect(serializeOffer(draft).salary).toBe(120_000);
    expect(serializeOffer({ ...draft, status: "nope" as never }).status).toBe("draft");

    await expect(
      offerService.create(recruiter, application, { salary: 130_000 }),
    ).rejects.toBeInstanceOf(ConflictError);

    const model = await Offer.findOrFail(draft.id);
    expect(serializeOffer(model).id).toBe(draft.id);
    await expect(offerService.accept(candidate, model)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(offerService.send(candidate, model)).rejects.toBeInstanceOf(ForbiddenError);

    const sent = await offerService.send(recruiter, model);
    expect(sent.status).toBe("sent");
    await expect(
      offerService.send(recruiter, await Offer.findOrFail(sent.id)),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect((await offerService.listForApplication(candidate, application)).length).toBe(1);
    await expect(offerService.listForApplication(other, application)).rejects.toBeInstanceOf(
      ForbiddenError,
    );

    const withdrawn = await offerService.withdraw(recruiter, await Offer.findOrFail(sent.id));
    expect(withdrawn.status).toBe("withdrawn");
    await expect(
      offerService.withdraw(recruiter, await Offer.findOrFail(withdrawn.id)),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const dated = await offerService.create(recruiter, application, {
      salary: 125_000,
      starts_on: "2026-10-01",
      notes: "reloc",
    });
    expect(serializeOffer(dated).starts_on).toBe("2026-10-01");
    const acceptApp = await Offer.findOrFail(dated.id);
    await offerService.send(recruiter, acceptApp);
    await expect(
      offerService.accept(recruiter, await Offer.findOrFail(dated.id)),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      offerService.accept(other, await Offer.findOrFail(dated.id)),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const accepted = await offerService.accept(candidate, await Offer.findOrFail(dated.id));
    expect(accepted.status).toBe("accepted");

    const declineApp = await openApplication(candidate.id);
    const declineDraft = await offerService.create(recruiter, declineApp, { salary: 80_000 });
    await offerService.send(recruiter, await Offer.findOrFail(declineDraft.id));
    const declined = await offerService.decline(candidate, await Offer.findOrFail(declineDraft.id));
    expect(declined.status).toBe("declined");

    const httpApp = await openApplication(candidate.id);
    const created = await jsonRequest(`/api/applications/${httpApp.id}/offers`, {
      cookies: recruiterCookies,
      method: "POST",
      body: JSON.stringify({ salary: 99_000, notes: "http" }),
    });
    expect(created.response.status).toBe(200);
    expect(created.body.status).toBe("draft");
    const listed = await jsonRequest(`/api/applications/${httpApp.id}/offers`, {
      cookies: recruiterCookies,
    });
    expect(listed.body.length).toBe(1);
    const sentHttp = await jsonRequest(`/api/offers/${created.body.id}/send`, {
      cookies: recruiterCookies,
      method: "POST",
    });
    expect(sentHttp.body.status).toBe("sent");
    const acceptedHttp = await jsonRequest(`/api/offers/${created.body.id}/accept`, {
      cookies: candidateCookies,
      method: "POST",
    });
    expect(acceptedHttp.body.status).toBe("accepted");

    const htmlApp = await openApplication(candidate.id);
    const primed = await request(`/applications/${htmlApp.id}`, { cookies: recruiterCookies });
    const html = await request(`/applications/${htmlApp.id}/offers`, {
      cookies: primed.cookies,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-csrf-token": csrfFrom(primed.cookies),
      },
      body: "salary=77000&starts_on=2026-11-01&notes=html",
    });
    expect([302, 303].includes(html.response.status)).toBe(true);
  });
});
