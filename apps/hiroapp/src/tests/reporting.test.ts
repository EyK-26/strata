import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { STATUS } from "../lib/roles.ts";
import { reportingService, startOfUtcMonth } from "../modules/applications/reporting.ts";
import {
  bootHiroapp,
  collectCookies,
  cookieHeader,
  csrfFrom,
  seededUser,
  signInCookie,
} from "./helpers.ts";

const enabled = process.env.HIROAPP_TEST === "1";

describe.skipIf(!enabled)("Wave 20 application reporting", () => {
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

  test("startOfUtcMonth is the first UTC instant of the month", () => {
    const start = startOfUtcMonth(new Date("2026-09-18T15:04:05.000Z"));
    expect(start.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  test("dashboard filters by department and status; export chunks applications", async () => {
    const recruiter = await seededUser("recruiter@hiroapp.com");
    expect(await reportingService.dashboard({})).toEqual([]);
    expect(await reportingService.dashboard({ department_id: 0 })).toEqual([]);

    const inDept = await reportingService.dashboard({ department_id: 1 });
    expect(inDept.length).toBeGreaterThan(0);

    const hired = await reportingService.dashboard({ department_id: 1, hired: true });
    expect(hired.every((row) => Number(row.status_id) === STATUS.HIRED)).toBe(true);

    const feedback = await reportingService.dashboard({ department_id: 1, feedback: true });
    expect(feedback.every((row) => Number(row.status_id) === STATUS.FEEDBACK)).toBe(true);

    const ended = await reportingService.dashboard({ department_id: 1, rejected: true });
    expect(ended.every((row) => Number(row.status_id) === STATUS.ENDED)).toBe(true);

    const interview = await reportingService.dashboard({ department_id: 1, interview: true });
    expect(interview.every((row) => Number(row.status_id) === STATUS.INTERVIEW)).toBe(true);

    const lastWins = await reportingService.dashboard({
      department_id: 1,
      feedback: true,
      hired: true,
    });
    expect(lastWins.every((row) => Number(row.status_id) === STATUS.HIRED)).toBe(true);

    const thisMonth = await reportingService.dashboard({ department_id: 1, month: true });
    expect(thisMonth.length).toBeGreaterThan(0);

    const missingDept = await reportingService.dashboard({ department_id: 9_999_999 });
    expect(missingDept).toEqual([]);

    const exported = await reportingService.exportAll(recruiter);
    expect(exported.count).toBeGreaterThan(0);
    expect(exported.data.length).toBe(exported.count);
    expect(exported.cursor.count).toBeGreaterThan(0);
    expect(typeof exported.cursor.has_more).toBe("boolean");

    const httpExport = await jsonRequest("/api/export/applications", {
      cookies: recruiterCookies,
    });
    expect(httpExport.response.status).toBe(200);
    expect(httpExport.body.count).toBeGreaterThan(0);

    const forbidden = await jsonRequest("/api/export/applications", {
      cookies: candidateCookies,
    });
    expect(forbidden.response.status).toBe(403);

    const count = await jsonRequest("/api/dashboard/count?department_id=1", {
      cookies: recruiterCookies,
    });
    expect(count.response.status).toBe(200);
    expect(count.body).toBeGreaterThan(0);

    const emptyCount = await jsonRequest("/api/dashboard/count", { cookies: recruiterCookies });
    expect(emptyCount.body).toBe(0);

    const data = await jsonRequest(
      "/api/dashboard/data?department_id=1&isInterviewRestricted=true",
      { cookies: recruiterCookies },
    );
    expect(data.response.status).toBe(200);
    expect(Array.isArray(data.body)).toBe(true);
  });
});
