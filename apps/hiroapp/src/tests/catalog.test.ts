import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { catalogService } from "../modules/catalog/service.ts";
import { bootHiroapp, collectCookies, cookieHeader, csrfFrom, signInCookie } from "./helpers.ts";

const enabled = process.env.HIROAPP_TEST === "1";

describe.skipIf(!enabled)("Wave 23 hiring catalog", () => {
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

  test("staff can read roles, grades, and statuses", async () => {
    const snapshot = await catalogService.snapshot();
    expect(snapshot.roles.some((row) => row.name === "admin")).toBe(true);
    expect(snapshot.grades.some((row) => row.name === "medium")).toBe(true);
    expect(snapshot.statuses.some((row) => row.name === "applied")).toBe(true);
    expect((await catalogService.roles()).length).toBeGreaterThan(0);
    expect((await catalogService.grades()).length).toBeGreaterThan(0);
    expect((await catalogService.statuses()).length).toBeGreaterThan(0);

    const applied = snapshot.statuses.find((row) => row.name === "applied");
    if (!applied) {
      throw new Error("missing applied status");
    }
    expect(await catalogService.statusById(applied.id)).toEqual(applied);
    expect(await catalogService.statusById(9_999_999)).toBeNull();

    const forbidden = await jsonRequest("/api/catalog", { cookies: candidateCookies });
    expect(forbidden.response.status).toBe(403);

    const http = await jsonRequest("/api/catalog", { cookies: recruiterCookies });
    expect(http.response.status).toBe(200);
    expect(http.body.roles.some((row: { name: string }) => row.name === "recruiter")).toBe(true);
    expect(http.body.grades.length).toBeGreaterThan(0);
    expect(http.body.statuses.length).toBeGreaterThan(0);
  });
});
