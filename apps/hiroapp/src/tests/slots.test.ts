import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { hashPassword } from "@getstrata/core/auth/password";
import {
  ForbiddenError,
  UnprocessableEntityError,
  ValidationError,
} from "@getstrata/core/errors/http";
import { ROLE, STATUS } from "../lib/roles.ts";
import { Application } from "../models/Application.ts";
import { Position } from "../models/Position.ts";
import { Slot } from "../models/Slot.ts";
import { applicationService } from "../modules/applications/service.ts";
import { serializeSlot, slotService } from "../modules/slots/service.ts";
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

describe.skipIf(!enabled)("Wave 30 interview slots", () => {
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
      name: `Slot Seat ${Date.now()}-${Math.random()}`,
      description: "slots",
      hiring: true,
      start_date: null,
      end_date: null,
    });
  }

  test("staff publish slots; candidates book after applying", async () => {
    const candidate = await seededUser("candidate@hiroapp.com");
    const recruiter = await seededUser("recruiter@hiroapp.com");
    const other = await users.create({
      first_name: "Other",
      last_name: "Booker",
      email: `other.slot.${Date.now()}@hiroapp.com`,
      password: await hashPassword("password"),
      role_id: ROLE.CANDIDATE,
    });
    const seat = await openSeat();

    await expect(
      slotService.create(candidate, seat, {
        starts_at: "2026-10-01T10:00",
        ends_at: "2026-10-01T11:00",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      slotService.create(recruiter, seat, {
        starts_at: "not-a-date",
        ends_at: "2026-10-01T11:00",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      slotService.create(recruiter, seat, {
        starts_at: "2026-10-01T10:00",
        ends_at: "nope",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      slotService.create(recruiter, seat, {
        starts_at: "2026-10-01T11:00",
        ends_at: "2026-10-01T10:00",
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityError);

    const created = await slotService.create(recruiter, seat, {
      starts_at: "2026-10-01T10:00",
      ends_at: "2026-10-01T11:00",
    });
    expect(created.status).toBe("open");
    expect(serializeSlot(created).booked_by).toBeNull();
    const model = await Slot.findOrFail(created.id);
    expect(serializeSlot(model).status).toBe("open");
    expect(serializeSlot({ ...created, status: "nope" as never }).status).toBe("open");
    expect((await seat.slots()).length).toBe(1);

    const toCancel = await slotService.create(recruiter, seat, {
      starts_at: "2026-10-02T10:00",
      ends_at: "2026-10-02T11:00",
    });
    const cancelled = await slotService.cancel(recruiter, await Slot.findOrFail(toCancel.id));
    expect(cancelled.status).toBe("cancelled");
    await expect(
      slotService.cancel(recruiter, await Slot.findOrFail(toCancel.id)),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      slotService.cancel(candidate, await Slot.findOrFail(created.id)),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const staffList = await slotService.listForPosition(recruiter, seat);
    expect(staffList.length).toBe(2);
    const candidateList = await slotService.listForPosition(candidate, seat);
    expect(candidateList.every((row) => row.status === "open")).toBe(true);

    await expect(
      slotService.book(recruiter, await Slot.findOrFail(created.id)),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      slotService.book(candidate, await Slot.findOrFail(created.id)),
    ).rejects.toBeInstanceOf(UnprocessableEntityError);

    await applicationService.apply(candidate, {
      position_id: Number(seat.id),
      attachment_text: null,
      attachment_file: null,
    });
    const booked = await slotService.book(candidate, await Slot.findOrFail(created.id));
    expect(booked.status).toBe("booked");
    expect(booked.booked_by).toBe(candidate.id);
    expect(booked.interview_id).not.toBeNull();
    await expect(slotService.book(other, await Slot.findOrFail(created.id))).rejects.toBeInstanceOf(
      ForbiddenError,
    );

    const afterBook = await slotService.listForPosition(candidate, seat);
    expect(afterBook.some((row) => row.id === booked.id && row.status === "booked")).toBe(true);
    expect(afterBook.some((row) => row.status === "cancelled")).toBe(false);

    const httpSeat = await openSeat();
    const forbiddenCreate = await jsonRequest(`/api/positions/${httpSeat.id}/slots`, {
      cookies: candidateCookies,
      method: "POST",
      body: JSON.stringify({ starts_at: "2026-10-03T10:00", ends_at: "2026-10-03T11:00" }),
    });
    expect(forbiddenCreate.response.status).toBe(403);
    const httpCreated = await jsonRequest(`/api/positions/${httpSeat.id}/slots`, {
      cookies: recruiterCookies,
      method: "POST",
      body: JSON.stringify({ starts_at: "2026-10-03T10:00", ends_at: "2026-10-03T11:00" }),
    });
    expect(httpCreated.response.status).toBe(200);
    expect(httpCreated.body.status).toBe("open");
    const listed = await jsonRequest(`/api/positions/${httpSeat.id}/slots`, {
      cookies: recruiterCookies,
    });
    expect(listed.body.length).toBe(1);
    await applicationService.apply(candidate, {
      position_id: Number(httpSeat.id),
      attachment_text: null,
      attachment_file: null,
    });
    const bookedHttp = await jsonRequest(`/api/slots/${httpCreated.body.id}/book`, {
      cookies: candidateCookies,
      method: "POST",
    });
    expect(bookedHttp.body.status).toBe("booked");

    const cancelTarget = await jsonRequest(`/api/positions/${httpSeat.id}/slots`, {
      cookies: recruiterCookies,
      method: "POST",
      body: JSON.stringify({ starts_at: "2026-10-04T10:00", ends_at: "2026-10-04T11:00" }),
    });
    const cancelledHttp = await jsonRequest(`/api/slots/${cancelTarget.body.id}/cancel`, {
      cookies: recruiterCookies,
      method: "POST",
    });
    expect(cancelledHttp.body.status).toBe("cancelled");

    const htmlSeat = await openSeat();
    const primed = await request(`/positions/${htmlSeat.id}`, { cookies: recruiterCookies });
    const html = await request(`/positions/${htmlSeat.id}/slots`, {
      cookies: primed.cookies,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-csrf-token": csrfFrom(primed.cookies),
      },
      body: "starts_at=2026-10-05T10%3A00&ends_at=2026-10-05T11%3A00",
    });
    expect([302, 303].includes(html.response.status)).toBe(true);
    const htmlSlots = await slotService.listForPosition(recruiter, htmlSeat);
    const htmlSlot = htmlSlots[0];
    if (!htmlSlot) {
      throw new Error("missing html slot");
    }
    await Application.create({
      user_id: candidate.id,
      position_id: Number(htmlSeat.id),
      status_id: STATUS.APPLIED,
      attachment_text: null,
      attachment_file: null,
    });
    const bookPage = await request(`/positions/${htmlSeat.id}`, { cookies: candidateCookies });
    const htmlBook = await request(`/slots/${htmlSlot.id}/book`, {
      cookies: bookPage.cookies,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-csrf-token": csrfFrom(bookPage.cookies),
      },
      body: `return_to=/positions/${htmlSeat.id}`,
    });
    expect([302, 303].includes(htmlBook.response.status)).toBe(true);
  });
});
