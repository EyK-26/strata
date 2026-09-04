import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnprocessableEntityError,
} from "@getstrata/core/errors/http";
import { CareerPosting } from "../models/CareerPosting.ts";
import { Position } from "../models/Position.ts";
import { careerService, serializeCareerPosting } from "../modules/careers/service.ts";
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

describe.skipIf(!enabled)("Wave 36 public careers", () => {
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

  async function openSeat(hiring = true) {
    return Position.create({
      user_id: null,
      department_id: 1,
      grade_id: 1,
      name: `Career Seat ${Date.now()}-${Math.random()}`,
      description: "careers",
      hiring,
      start_date: null,
      end_date: null,
    });
  }

  test("staff publish open seats; guests can browse published careers", async () => {
    const recruiter = await seededUser("recruiter@hiroapp.com");
    const candidate = await seededUser("candidate@hiroapp.com");
    const closed = await openSeat(false);
    const seat = await openSeat();

    expect(await careerService.forPosition(recruiter, seat)).toBeNull();
    await expect(careerService.forPosition(candidate, seat)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(careerService.publish(candidate, seat)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(careerService.publish(recruiter, closed)).rejects.toBeInstanceOf(
      UnprocessableEntityError,
    );

    const created = await careerService.publish(recruiter, seat);
    expect(created.status).toBe("published");
    const model = await CareerPosting.findOrFail(created.id);
    expect(serializeCareerPosting(model).status).toBe("published");
    expect(serializeCareerPosting({ ...created, status: "nope" as never }).status).toBe(
      "unpublished",
    );
    expect((await seat.careerPosting())?.id).toBe(created.id);
    await expect(careerService.publish(recruiter, seat)).rejects.toBeInstanceOf(ConflictError);

    const publicList = await careerService.listPublic();
    expect(publicList.some((row) => row.id === created.id && row.name === seat.get("name"))).toBe(
      true,
    );
    const shown = await careerService.showPublic(await CareerPosting.findOrFail(created.id));
    expect(shown.description).toBe("careers");

    const unpublished = await careerService.unpublish(
      recruiter,
      await CareerPosting.findOrFail(created.id),
    );
    expect(unpublished.status).toBe("unpublished");
    await expect(
      careerService.unpublish(recruiter, await CareerPosting.findOrFail(created.id)),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      careerService.showPublic(await CareerPosting.findOrFail(created.id)),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect((await careerService.listPublic()).some((row) => row.id === created.id)).toBe(false);

    const republished = await careerService.publish(recruiter, seat);
    expect(republished.id).toBe(created.id);
    expect(republished.status).toBe("published");

    await positionService.close(recruiter, await Position.findOrFail(Number(seat.id)));
    expect((await careerService.listPublic()).some((row) => row.id === created.id)).toBe(false);
    await expect(
      careerService.showPublic(await CareerPosting.findOrFail(created.id)),
    ).rejects.toBeInstanceOf(NotFoundError);

    const httpSeat = await openSeat();
    const forbidden = await jsonRequest(`/api/positions/${httpSeat.id}/career`, {
      cookies: candidateCookies,
      method: "POST",
    });
    expect(forbidden.response.status).toBe(403);
    const empty = await jsonRequest(`/api/positions/${httpSeat.id}/career`, {
      cookies: recruiterCookies,
    });
    expect(empty.body).toBeNull();
    const httpPublished = await jsonRequest(`/api/positions/${httpSeat.id}/career`, {
      cookies: recruiterCookies,
      method: "POST",
    });
    expect(httpPublished.body.status).toBe("published");
    const publicHttp = await request("/api/careers");
    const publicBody = JSON.parse(publicHttp.text) as Array<{ id: number }>;
    expect(publicBody.some((row) => row.id === httpPublished.body.id)).toBe(true);
    const publicShow = await request(`/api/careers/${httpPublished.body.id}`);
    expect(publicShow.response.status).toBe(200);
    const httpUnpublish = await jsonRequest(`/api/careers/${httpPublished.body.id}/unpublish`, {
      cookies: recruiterCookies,
      method: "POST",
    });
    expect(httpUnpublish.body.status).toBe("unpublished");
    const hidden = await request(`/api/careers/${httpPublished.body.id}`);
    expect(hidden.response.status).toBe(404);

    const htmlSeat = await openSeat();
    const page = await request(`/positions/${htmlSeat.id}`, { cookies: recruiterCookies });
    expect(page.response.status).toBe(200);
    const htmlPublish = await request(`/positions/${htmlSeat.id}/career`, {
      cookies: page.cookies,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-csrf-token": csrfFrom(page.cookies),
      },
      body: `return_to=/positions/${htmlSeat.id}`,
    });
    expect([302, 303].includes(htmlPublish.response.status)).toBe(true);
    const htmlPosting = await careerService.forPosition(recruiter, htmlSeat);
    if (!htmlPosting) {
      throw new Error("missing html career posting");
    }
    const careersPage = await request("/careers");
    expect(careersPage.response.status).toBe(200);
    expect(careersPage.text.includes("Careers")).toBe(true);
    const showPage = await request(`/careers/${htmlPosting.id}`);
    expect(showPage.response.status).toBe(200);
    const unpublishPage = await request(`/positions/${htmlSeat.id}`, { cookies: recruiterCookies });
    const htmlUnpublish = await request(`/careers/${htmlPosting.id}/unpublish`, {
      cookies: unpublishPage.cookies,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-csrf-token": csrfFrom(unpublishPage.cookies),
      },
      body: `return_to=/positions/${htmlSeat.id}`,
    });
    expect([302, 303].includes(htmlUnpublish.response.status)).toBe(true);
  });
});
