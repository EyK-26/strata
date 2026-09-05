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
import { departmentService } from "../modules/departments/service.ts";
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
      body: JSON.stringify({}),
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

  test("staff expire published careers; past deadlines auto-expire", async () => {
    const recruiter = await seededUser("recruiter@hiroapp.com");
    const candidate = await seededUser("candidate@hiroapp.com");
    const { careerPostings } = await import("../modules/careers/repository.ts");

    const unpublishedSeat = await openSeat();
    const unpublished = await careerService.publish(recruiter, unpublishedSeat);
    await careerService.unpublish(recruiter, await CareerPosting.findOrFail(unpublished.id));
    await expect(
      careerService.expire(candidate, await CareerPosting.findOrFail(unpublished.id)),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      careerService.expire(recruiter, await CareerPosting.findOrFail(unpublished.id)),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const seat = await openSeat();
    await expect(
      careerService.publish(recruiter, seat, { expires_at: "not-a-date" }),
    ).rejects.toBeInstanceOf(UnprocessableEntityError);
    await expect(
      careerService.publish(recruiter, seat, { expires_at: "2020-01-01T00:00:00Z" }),
    ).rejects.toBeInstanceOf(UnprocessableEntityError);

    const created = await careerService.publish(recruiter, seat, {
      expires_at: "2026-12-01T12:00:00Z",
    });
    expect(created.status).toBe("published");
    expect(serializeCareerPosting(created).expires_at).toBe("2026-12-01T12:00:00.000Z");
    expect(serializeCareerPosting(created).status).toBe("published");
    const listedFuture = await careerService.listPublic();
    expect(listedFuture.some((row) => row.id === created.id)).toBe(true);

    const expired = await careerService.expire(
      recruiter,
      await CareerPosting.findOrFail(created.id),
    );
    expect(expired.status).toBe("expired");
    expect(serializeCareerPosting(expired).status).toBe("expired");
    await expect(
      careerService.expire(recruiter, await CareerPosting.findOrFail(expired.id)),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      careerService.showPublic(await CareerPosting.findOrFail(expired.id)),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect((await careerService.listPublic()).some((row) => row.id === created.id)).toBe(false);

    const republished = await careerService.publish(recruiter, seat, { expires_at: "  " });
    expect(republished.id).toBe(created.id);
    expect(republished.status).toBe("published");
    expect(serializeCareerPosting(republished).expires_at).toBeNull();

    const staleSeat = await openSeat();
    const stale = await careerService.publish(recruiter, staleSeat, {
      expires_at: "2026-12-15T00:00:00Z",
    });
    await careerPostings.updateByIdOrThrow(stale.id, {
      expires_at: new Date("2020-01-01T00:00:00Z"),
    });
    await expect(
      careerService.showPublic(await CareerPosting.findOrFail(stale.id)),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(serializeCareerPosting(await CareerPosting.findOrFail(stale.id)).status).toBe("expired");
    expect((await careerService.listPublic()).some((row) => row.id === stale.id)).toBe(false);
    expect((await careerService.forPosition(recruiter, staleSeat))?.status).toBe("expired");

    const httpSeat = await openSeat();
    const httpPublished = await jsonRequest(`/api/positions/${httpSeat.id}/career`, {
      cookies: recruiterCookies,
      method: "POST",
      body: JSON.stringify({ expires_at: "2026-12-20T00:00:00Z" }),
    });
    expect(httpPublished.body.status).toBe("published");
    const forbiddenHttp = await jsonRequest(`/api/careers/${httpPublished.body.id}/expire`, {
      cookies: candidateCookies,
      method: "POST",
    });
    expect(forbiddenHttp.response.status).toBe(403);
    const httpExpired = await jsonRequest(`/api/careers/${httpPublished.body.id}/expire`, {
      cookies: recruiterCookies,
      method: "POST",
    });
    expect(httpExpired.response.status).toBe(200);
    expect(httpExpired.body.status).toBe("expired");

    const htmlSeat = await openSeat();
    await careerService.publish(recruiter, htmlSeat);
    const page = await request(`/positions/${htmlSeat.id}`, { cookies: recruiterCookies });
    expect(page.response.status).toBe(200);
    expect(page.text).toContain("Expire from careers");
    const htmlPosting = await careerService.forPosition(recruiter, htmlSeat);
    if (!htmlPosting) {
      throw new Error("missing html career posting");
    }
    const html = await request(`/careers/${htmlPosting.id}/expire`, {
      cookies: page.cookies,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-csrf-token": csrfFrom(page.cookies),
      },
      body: `return_to=/positions/${htmlSeat.id}`,
    });
    expect([302, 303].includes(html.response.status)).toBe(true);
    expect((await CareerPosting.findOrFail(htmlPosting.id)).get("status")).toBe("expired");
  });

  test("staff can schedule career publish; due schedules go live", async () => {
    const recruiter = await seededUser("recruiter@hiroapp.com");
    const admin = await seededUser("admin@hiroapp.com");
    const { careerPostings } = await import("../modules/careers/repository.ts");

    const seat = await openSeat();
    await expect(
      careerService.publish(recruiter, seat, { publish_at: "not-a-date" }),
    ).rejects.toBeInstanceOf(UnprocessableEntityError);
    await expect(
      careerService.publish(recruiter, seat, { publish_at: "2020-01-01T00:00:00Z" }),
    ).rejects.toBeInstanceOf(UnprocessableEntityError);
    await expect(
      careerService.publish(recruiter, seat, {
        publish_at: "2026-12-01T12:00:00Z",
        expires_at: "2026-11-01T12:00:00Z",
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityError);

    const immediate = await careerService.publish(recruiter, seat, { publish_at: "  " });
    expect(immediate.status).toBe("published");
    expect(serializeCareerPosting(immediate).publish_at).toBeNull();
    await careerService.unpublish(recruiter, await CareerPosting.findOrFail(immediate.id));

    const created = await careerService.publish(recruiter, seat, {
      publish_at: "2026-12-01T12:00:00Z",
    });
    expect(created.status).toBe("scheduled");
    expect(serializeCareerPosting(created).status).toBe("scheduled");
    expect(serializeCareerPosting(created).publish_at).toBe("2026-12-01T12:00:00.000Z");
    await expect(careerService.publish(recruiter, seat)).rejects.toBeInstanceOf(ConflictError);
    await expect(
      careerService.expire(recruiter, await CareerPosting.findOrFail(created.id)),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      careerService.showPublic(await CareerPosting.findOrFail(created.id)),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect((await careerService.listPublic()).some((row) => row.id === created.id)).toBe(false);

    const cancelled = await careerService.unpublish(
      recruiter,
      await CareerPosting.findOrFail(created.id),
    );
    expect(cancelled.status).toBe("unpublished");
    const rescheduled = await careerService.publish(recruiter, seat, {
      publish_at: "2026-12-10T00:00:00Z",
    });
    expect(rescheduled.id).toBe(created.id);
    expect(rescheduled.status).toBe("scheduled");

    await careerPostings.updateByIdOrThrow(rescheduled.id, {
      publish_at: new Date("2020-01-01T00:00:00Z"),
    });
    const live = await careerService.forPosition(recruiter, seat);
    expect(live?.status).toBe("published");
    expect((await careerService.listPublic()).some((row) => row.id === rescheduled.id)).toBe(true);
    const shown = await careerService.showPublic(await CareerPosting.findOrFail(rescheduled.id));
    expect(shown.status).toBe("published");

    const closedSeat = await openSeat();
    const closed = await careerService.publish(recruiter, closedSeat, {
      publish_at: "2026-12-20T00:00:00Z",
    });
    await positionService.close(recruiter, await Position.findOrFail(Number(closedSeat.id)));
    await careerPostings.updateByIdOrThrow(closed.id, {
      publish_at: new Date("2020-01-01T00:00:00Z"),
    });
    expect((await careerService.forPosition(recruiter, closedSeat))?.status).toBe("scheduled");

    const frozenDepartment = await departmentService.create(`Career Schedule ${Date.now()}`);
    const frozenSeat = await Position.create({
      user_id: null,
      department_id: frozenDepartment.id,
      grade_id: 1,
      name: `Scheduled Freeze ${Date.now()}`,
      description: "frozen schedule",
      hiring: true,
      start_date: null,
      end_date: null,
    });
    const frozen = await careerService.publish(admin, frozenSeat, {
      publish_at: "2026-12-22T00:00:00Z",
    });
    await departmentService.freeze(admin, frozenDepartment.id);
    await careerPostings.updateByIdOrThrow(frozen.id, {
      publish_at: new Date("2020-01-01T00:00:00Z"),
    });
    expect((await careerService.forPosition(admin, frozenSeat))?.status).toBe("scheduled");

    const undatedSeat = await openSeat();
    const undated = await careerService.publish(recruiter, undatedSeat, {
      publish_at: "2026-12-25T00:00:00Z",
    });
    await careerPostings.updateByIdOrThrow(undated.id, { publish_at: null });
    expect((await careerService.forPosition(recruiter, undatedSeat))?.status).toBe("published");

    const httpSeat = await openSeat();
    const httpScheduled = await jsonRequest(`/api/positions/${httpSeat.id}/career`, {
      cookies: recruiterCookies,
      method: "POST",
      body: JSON.stringify({ publish_at: "2026-12-28T00:00:00Z" }),
    });
    expect(httpScheduled.body.status).toBe("scheduled");
    const httpCancel = await jsonRequest(`/api/careers/${httpScheduled.body.id}/unpublish`, {
      cookies: recruiterCookies,
      method: "POST",
    });
    expect(httpCancel.body.status).toBe("unpublished");

    const htmlSeat = await openSeat();
    const page = await request(`/positions/${htmlSeat.id}`, { cookies: recruiterCookies });
    expect(page.response.status).toBe(200);
    expect(page.text).toContain("Publish at");
    const html = await request(`/positions/${htmlSeat.id}/career`, {
      cookies: page.cookies,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-csrf-token": csrfFrom(page.cookies),
      },
      body: `publish_at=2026-12-30T09%3A00&return_to=/positions/${htmlSeat.id}`,
    });
    expect([302, 303].includes(html.response.status)).toBe(true);
    expect((await careerService.forPosition(recruiter, htmlSeat))?.status).toBe("scheduled");
    const scheduledPage = await request(`/positions/${htmlSeat.id}`, { cookies: recruiterCookies });
    expect(scheduledPage.text).toContain("Cancel scheduled publish");
  });
});
