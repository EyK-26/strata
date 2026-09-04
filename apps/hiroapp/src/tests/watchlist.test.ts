import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Position } from "../models/Position.ts";
import { careerService } from "../modules/careers/service.ts";
import { inboxService } from "../modules/notifications/inbox.ts";
import { watchlistService } from "../modules/positions/watchlist.ts";
import {
  bootHiroapp,
  collectCookies,
  cookieHeader,
  csrfFrom,
  seededUser,
  signInCookie,
} from "./helpers.ts";

const enabled = process.env.HIROAPP_TEST === "1";

describe.skipIf(!enabled)("Wave 17 watchlist", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl = "";
  let candidateCookies: string[] = [];
  let recruiterCookies: string[] = [];

  beforeAll(async () => {
    const boot = await bootHiroapp();
    server = boot.server;
    baseUrl = boot.baseUrl;
    candidateCookies = (await signInCookie("candidate@hiroapp.com")).cookies;
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

  test("toggle watch on and off and list ids", async () => {
    const candidate = await seededUser("candidate@hiroapp.com");
    const seat = await Position.create({
      user_id: null,
      department_id: 1,
      grade_id: 1,
      name: `Watch ${Date.now()}`,
      description: null,
      hiring: true,
      start_date: null,
      end_date: null,
    });

    const before = await watchlistService.ids(candidate);
    expect(before.includes(Number(seat.id))).toBe(false);

    const added = await watchlistService.toggle(candidate, seat);
    expect(added.watching).toBe(true);
    expect(added.ids.includes(Number(seat.id))).toBe(true);
    expect(added.count).toBeGreaterThan(0);
    expect((await watchlistService.list(candidate)).length).toBe(added.count);

    const removed = await watchlistService.toggle(candidate, seat);
    expect(removed.watching).toBe(false);
    expect(removed.ids.includes(Number(seat.id))).toBe(false);

    const httpOn = await jsonRequest(`/api/positions/${seat.id}/watch`, {
      cookies: candidateCookies,
      method: "POST",
    });
    expect(httpOn.response.status).toBe(200);
    expect(httpOn.body.watching).toBeGreaterThan(0);

    const listed = await jsonRequest("/api/me/watching", { cookies: candidateCookies });
    expect(listed.response.status).toBe(200);
    expect(listed.body.some((row: { id: number }) => Number(row.id) === Number(seat.id))).toBe(
      true,
    );

    const primed = await request(`/positions/${seat.id}`, { cookies: candidateCookies });
    const html = await request(`/positions/${seat.id}/watch`, {
      cookies: primed.cookies,
      method: "POST",
      headers: { "x-csrf-token": csrfFrom(primed.cookies) },
    });
    expect([302, 303].includes(html.response.status)).toBe(true);

    const page = await request("/watching", { cookies: candidateCookies });
    expect(page.response.status).toBe(200);
    expect(page.text).toContain("Watchlist");
    expect(page.text).toContain("Inbox alerts when a watched seat is published to careers.");
  });

  test("publishing a career alerts watchers", async () => {
    const candidate = await seededUser("candidate@hiroapp.com");
    const recruiter = await seededUser("recruiter@hiroapp.com");
    const emptySeat = await Position.create({
      user_id: null,
      department_id: 1,
      grade_id: 1,
      name: `Alert Empty ${Date.now()}`,
      description: null,
      hiring: true,
      start_date: null,
      end_date: null,
    });
    expect((await watchlistService.alertPublished(emptySeat, 0)).count).toBe(0);

    const seat = await Position.create({
      user_id: null,
      department_id: 1,
      grade_id: 1,
      name: `Alert Seat ${Date.now()}`,
      description: "watched",
      hiring: true,
      start_date: null,
      end_date: null,
    });
    await watchlistService.toggle(candidate, seat);
    const published = await careerService.publish(recruiter, seat);
    const inbox = await inboxService.list(candidate);
    expect(
      inbox.some((row) => row.get("type") === "App\\Notifications\\WatchlistCareerPublished"),
    ).toBe(true);
    expect(published.status).toBe("published");

    const httpSeat = await Position.create({
      user_id: null,
      department_id: 1,
      grade_id: 1,
      name: `Alert Http ${Date.now()}`,
      description: null,
      hiring: true,
      start_date: null,
      end_date: null,
    });
    await watchlistService.toggle(candidate, httpSeat);
    const httpPublished = await jsonRequest(`/api/positions/${httpSeat.id}/career`, {
      cookies: recruiterCookies,
      method: "POST",
    });
    expect(httpPublished.body.status).toBe("published");
    const notes = await jsonRequest("/api/notify/get", { cookies: candidateCookies });
    expect(
      notes.body.some(
        (row: { data?: { position_id?: number; subject?: string } }) =>
          Number(row.data?.position_id) === Number(httpSeat.id) &&
          row.data?.subject === "Watched role published",
      ),
    ).toBe(true);

    const htmlSeat = await Position.create({
      user_id: null,
      department_id: 1,
      grade_id: 1,
      name: `Alert Html ${Date.now()}`,
      description: null,
      hiring: true,
      start_date: null,
      end_date: null,
    });
    await watchlistService.toggle(candidate, htmlSeat);
    const page = await request(`/positions/${htmlSeat.id}`, { cookies: recruiterCookies });
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
    const home = await request("/", { cookies: candidateCookies });
    expect(home.response.status).toBe(200);
    expect(home.text).toContain("Watched role published");
  });
});
