import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { ConflictError, ForbiddenError } from "@getstrata/core/errors/http";
import { Position } from "../models/Position.ts";
import { Requisition } from "../models/Requisition.ts";
import { requisitionService, serializeRequisition } from "../modules/requisitions/service.ts";
import {
  bootHiroapp,
  collectCookies,
  cookieHeader,
  csrfFrom,
  seededUser,
  signInCookie,
} from "./helpers.ts";

const enabled = process.env.HIROAPP_TEST === "1";

describe.skipIf(!enabled)("Wave 34 position requisitions", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl = "";
  let recruiterCookies: string[] = [];
  let candidateCookies: string[] = [];
  let adminCookies: string[] = [];

  beforeAll(async () => {
    const boot = await bootHiroapp();
    server = boot.server;
    baseUrl = boot.baseUrl;
    recruiterCookies = (await signInCookie("recruiter@hiroapp.com")).cookies;
    candidateCookies = (await signInCookie("candidate@hiroapp.com")).cookies;
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

  async function openSeat() {
    return Position.create({
      user_id: null,
      department_id: 1,
      grade_id: 1,
      name: `Req Seat ${Date.now()}-${Math.random()}`,
      description: "requisition",
      hiring: true,
      start_date: null,
      end_date: null,
    });
  }

  test("staff submit requisitions; admins approve or reject", async () => {
    const recruiter = await seededUser("recruiter@hiroapp.com");
    const candidate = await seededUser("candidate@hiroapp.com");
    const admin = await seededUser("admin@hiroapp.com");
    const seat = await openSeat();

    expect(await requisitionService.forPosition(recruiter, seat)).toBeNull();
    await expect(requisitionService.listSubmitted(candidate)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(requisitionService.forPosition(candidate, seat)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      requisitionService.submit(candidate, seat, { notes: "nope" }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const created = await requisitionService.submit(recruiter, seat, {
      notes: "  backfill engineer  ",
    });
    expect(created.status).toBe("submitted");
    expect(created.notes).toBe("backfill engineer");
    expect(created.approved_by).toBeNull();
    const model = await Requisition.findOrFail(created.id);
    expect(serializeRequisition(model).status).toBe("submitted");
    expect(serializeRequisition({ ...created, status: "nope" as never }).status).toBe("submitted");
    expect((await seat.requisition())?.id).toBe(created.id);
    await expect(requisitionService.submit(recruiter, seat)).rejects.toBeInstanceOf(ConflictError);
    expect(
      (await requisitionService.listSubmitted(recruiter)).some((row) => row.id === created.id),
    ).toBe(true);
    expect(
      (await requisitionService.listSubmitted(admin)).some((row) => row.id === created.id),
    ).toBe(true);

    await expect(
      requisitionService.approve(recruiter, await Requisition.findOrFail(created.id)),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      requisitionService.reject(recruiter, await Requisition.findOrFail(created.id)),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const rejected = await requisitionService.reject(
      admin,
      await Requisition.findOrFail(created.id),
      "  not this quarter  ",
    );
    expect(rejected.status).toBe("rejected");
    expect(rejected.notes).toBe("not this quarter");
    expect(rejected.approved_by).toBe(admin.id);
    await expect(
      requisitionService.approve(admin, await Requisition.findOrFail(created.id)),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      requisitionService.reject(admin, await Requisition.findOrFail(created.id)),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const resubmitted = await requisitionService.submit(recruiter, seat, { notes: "retry" });
    expect(resubmitted.id).toBe(created.id);
    expect(resubmitted.status).toBe("submitted");
    expect(resubmitted.approved_by).toBeNull();
    const approved = await requisitionService.approve(
      admin,
      await Requisition.findOrFail(created.id),
    );
    expect(approved.status).toBe("approved");
    expect(approved.approved_by).toBe(admin.id);
    await expect(requisitionService.submit(recruiter, seat)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      requisitionService.approve(admin, await Requisition.findOrFail(created.id)),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const keepNotesSeat = await openSeat();
    const keepNotes = await requisitionService.submit(admin, keepNotesSeat, { notes: "keep me" });
    const rejectedKeep = await requisitionService.reject(
      admin,
      await Requisition.findOrFail(keepNotes.id),
    );
    expect(rejectedKeep.notes).toBe("keep me");

    const httpSeat = await openSeat();
    const forbidden = await jsonRequest(`/api/positions/${httpSeat.id}/requisition`, {
      cookies: candidateCookies,
      method: "POST",
      body: JSON.stringify({ notes: "nope" }),
    });
    expect(forbidden.response.status).toBe(403);
    const empty = await jsonRequest(`/api/positions/${httpSeat.id}/requisition`, {
      cookies: recruiterCookies,
    });
    expect(empty.body).toBeNull();
    const httpCreated = await jsonRequest(`/api/positions/${httpSeat.id}/requisition`, {
      cookies: recruiterCookies,
      method: "POST",
      body: JSON.stringify({ notes: "http" }),
    });
    expect(httpCreated.body.status).toBe("submitted");
    const recruiterApprove = await jsonRequest(`/api/requisitions/${httpCreated.body.id}/approve`, {
      cookies: recruiterCookies,
      method: "POST",
    });
    expect(recruiterApprove.response.status).toBe(403);
    const httpApproved = await jsonRequest(`/api/requisitions/${httpCreated.body.id}/approve`, {
      cookies: adminCookies,
      method: "POST",
    });
    expect(httpApproved.body.status).toBe("approved");

    const rejectSeat = await openSeat();
    const httpRejectReq = await jsonRequest(`/api/positions/${rejectSeat.id}/requisition`, {
      cookies: recruiterCookies,
      method: "POST",
      body: JSON.stringify({}),
    });
    const httpRejected = await jsonRequest(`/api/requisitions/${httpRejectReq.body.id}/reject`, {
      cookies: adminCookies,
      method: "POST",
      body: JSON.stringify({ notes: "later" }),
    });
    expect(httpRejected.body.status).toBe("rejected");

    const htmlSeat = await openSeat();
    const page = await request(`/positions/${htmlSeat.id}`, { cookies: recruiterCookies });
    expect(page.response.status).toBe(200);
    const htmlSubmit = await request(`/positions/${htmlSeat.id}/requisition`, {
      cookies: page.cookies,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-csrf-token": csrfFrom(page.cookies),
      },
      body: `notes=html&return_to=/positions/${htmlSeat.id}`,
    });
    expect([302, 303].includes(htmlSubmit.response.status)).toBe(true);
    const htmlReq = await requisitionService.forPosition(recruiter, htmlSeat);
    if (!htmlReq) {
      throw new Error("missing html requisition");
    }
    const adminPage = await request(`/positions/${htmlSeat.id}`, { cookies: adminCookies });
    const htmlApprove = await request(`/requisitions/${htmlReq.id}/approve`, {
      cookies: adminPage.cookies,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-csrf-token": csrfFrom(adminPage.cookies),
      },
      body: `return_to=/positions/${htmlSeat.id}`,
    });
    expect([302, 303].includes(htmlApprove.response.status)).toBe(true);

    const htmlRejectSeat = await openSeat();
    await requisitionService.submit(recruiter, htmlRejectSeat, { notes: "html reject" });
    const htmlRejectReq = await requisitionService.forPosition(admin, htmlRejectSeat);
    if (!htmlRejectReq) {
      throw new Error("missing html reject requisition");
    }
    const rejectPage = await request(`/positions/${htmlRejectSeat.id}`, { cookies: adminCookies });
    const htmlReject = await request(`/requisitions/${htmlRejectReq.id}/reject`, {
      cookies: rejectPage.cookies,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-csrf-token": csrfFrom(rejectPage.cookies),
      },
      body: `notes=html+no&return_to=/positions/${htmlRejectSeat.id}`,
    });
    expect([302, 303].includes(htmlReject.response.status)).toBe(true);
  });
});
