import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { UnprocessableEntityError } from "@getstrata/core/errors/http";
import { Position } from "../models/Position.ts";
import { User } from "../models/User.ts";
import { commentService, serializeComment } from "../modules/comments/service.ts";
import {
  bootHiroapp,
  collectCookies,
  cookieHeader,
  csrfFrom,
  seededUser,
  signInCookie,
} from "./helpers.ts";

const enabled = process.env.HIROAPP_TEST === "1";

describe.skipIf(!enabled)("Wave 19 hiring comments", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl = "";
  let recruiterCookies: string[] = [];

  beforeAll(async () => {
    const boot = await bootHiroapp();
    server = boot.server;
    baseUrl = boot.baseUrl;
    recruiterCookies = (await signInCookie("recruiter@hiroapp.com")).cookies;
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

  test("staff can comment on applications and positions", async () => {
    const recruiter = await seededUser("recruiter@hiroapp.com");
    const candidate = await seededUser("candidate@hiroapp.com");
    const apps = await User.newFromRecord(candidate).applications();
    const application = apps[0];
    if (!application) {
      throw new Error("Missing seeded application");
    }

    await expect(
      commentService.addToApplication(recruiter, application, "   "),
    ).rejects.toBeInstanceOf(UnprocessableEntityError);

    const note = await commentService.addToApplication(recruiter, application, "  pipeline note  ");
    expect(note.get("body")).toBe("pipeline note");
    const listed = await commentService.forApplication(application);
    expect(listed.some((row) => Number(row.id) === Number(note.id))).toBe(true);
    expect(serializeComment(note).author).toBeNull();
    const named = await commentService.serializedForApplication(application);
    expect(
      named.some(
        (row) => row.body === "pipeline note" && row.author?.first_name === recruiter.first_name,
      ),
    ).toBe(true);

    const seat = await Position.create({
      user_id: null,
      department_id: 1,
      grade_id: 1,
      name: `Comment ${Date.now()}`,
      description: null,
      hiring: true,
      start_date: null,
      end_date: null,
    });
    await expect(commentService.addToPosition(recruiter, seat, "")).rejects.toBeInstanceOf(
      UnprocessableEntityError,
    );
    const onSeat = await commentService.addToPosition(recruiter, seat, "panel note");
    expect(
      (await commentService.forPosition(seat)).some((row) => Number(row.id) === Number(onSeat.id)),
    ).toBe(true);
    expect((await commentService.serializedForPosition(seat)).length).toBeGreaterThan(0);

    const httpApp = await jsonRequest(`/api/applications/${application.id}/comments`, {
      cookies: recruiterCookies,
      method: "POST",
      body: JSON.stringify({ body: "http application comment" }),
    });
    expect(httpApp.response.status).toBe(200);
    expect(httpApp.body.body).toBe("http application comment");

    const httpList = await jsonRequest(`/api/applications/${application.id}/comments`, {
      cookies: recruiterCookies,
    });
    expect(
      httpList.body.some((row: { body: string }) => row.body === "http application comment"),
    ).toBe(true);

    const httpSeat = await jsonRequest(`/api/positions/${seat.id}/comments`, {
      cookies: recruiterCookies,
      method: "POST",
      body: JSON.stringify({ body: "http position comment" }),
    });
    expect(httpSeat.response.status).toBe(200);
    const seatList = await jsonRequest(`/api/positions/${seat.id}/comments`, {
      cookies: recruiterCookies,
    });
    expect(
      seatList.body.some((row: { body: string }) => row.body === "http position comment"),
    ).toBe(true);

    const primed = await request(`/applications/${application.id}`, { cookies: recruiterCookies });
    const html = await request(`/applications/${application.id}/comments`, {
      cookies: primed.cookies,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-csrf-token": csrfFrom(primed.cookies),
      },
      body: "body=html+application+comment",
    });
    expect([302, 303].includes(html.response.status)).toBe(true);

    const positionPage = await request(`/positions/${seat.id}`, { cookies: recruiterCookies });
    const htmlSeat = await request(`/positions/${seat.id}/comments`, {
      cookies: positionPage.cookies,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-csrf-token": csrfFrom(positionPage.cookies),
      },
      body: "body=html+position+comment",
    });
    expect([302, 303].includes(htmlSeat.response.status)).toBe(true);
  });
});
