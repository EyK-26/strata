import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { NotFoundError } from "@getstrata/core/errors/http";
import { FAILED_JOB_SERVICE_TOKEN } from "@getstrata/core/queue/createAppQueue";
import type FailedJobService from "@getstrata/core/queue/failedJobService";
import { failedJobsAdmin } from "../modules/dashboard/failedJobs.ts";
import { bootHiroapp, collectCookies, cookieHeader, csrfFrom, signInCookie } from "./helpers.ts";

const enabled = process.env.HIROAPP_TEST === "1";

describe.skipIf(!enabled)("Wave 22 failed-jobs admin", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl = "";
  let adminCookies: string[] = [];
  let candidateCookies: string[] = [];
  let failedJobs: FailedJobService;

  beforeAll(async () => {
    const boot = await bootHiroapp();
    server = boot.server;
    baseUrl = boot.baseUrl;
    failedJobs = boot.context.container.resolve<FailedJobService>(FAILED_JOB_SERVICE_TOKEN);
    adminCookies = (await signInCookie("admin@hiroapp.com")).cookies;
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

  test("lists, presents, and retries failed jobs", async () => {
    expect(Array.isArray(await failedJobsAdmin.list())).toBe(true);
    await expect(failedJobsAdmin.retry(9_999_999)).rejects.toBeInstanceOf(NotFoundError);

    const recorded = await failedJobs.recordFailure({
      jobName: "hiroapp-failed-jobs-admin",
      payload: { wave: 22 },
      exception: "boom",
    });
    const presented = failedJobsAdmin.present(recorded);
    expect(presented.id).toBe(Number(recorded.id));
    expect(presented.job_name).toBe("hiroapp-failed-jobs-admin");

    const listed = await failedJobsAdmin.list(10);
    expect(listed.some((row) => row.id === Number(recorded.id))).toBe(true);

    const retried = await failedJobsAdmin.retry(Number(recorded.id));
    expect(retried).toEqual({
      retried: true,
      id: Number(recorded.id),
      job_name: "hiroapp-failed-jobs-admin",
    });
    await expect(failedJobsAdmin.retry(Number(recorded.id))).rejects.toBeInstanceOf(NotFoundError);

    const forbidden = await jsonRequest("/api/failed-jobs", { cookies: candidateCookies });
    expect(forbidden.response.status).toBe(403);

    const missing = await jsonRequest("/api/failed-jobs/999999/retry", {
      cookies: adminCookies,
      method: "POST",
    });
    expect(missing.response.status).toBe(404);

    const again = await failedJobs.recordFailure({
      jobName: "hiroapp-failed-jobs-http",
      payload: {},
      exception: "again",
    });
    const http = await jsonRequest(`/api/failed-jobs/${again.id}/retry`, {
      cookies: adminCookies,
      method: "POST",
    });
    expect(http.response.status).toBe(200);
    expect(http.body.retried).toBe(true);

    const page = await request("/failed-jobs", { cookies: adminCookies });
    expect(page.response.status).toBe(200);
  });
});
