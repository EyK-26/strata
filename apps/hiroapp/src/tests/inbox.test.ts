import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { inboxService } from "../modules/notifications/inbox.ts";
import { notifyUser } from "../modules/notifications/service.ts";
import {
  bootHiroapp,
  collectCookies,
  cookieHeader,
  csrfFrom,
  seededUser,
  signInCookie,
} from "./helpers.ts";

const enabled = process.env.HIROAPP_TEST === "1";

describe.skipIf(!enabled)("Wave 21 notification inbox", () => {
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

  test("list, mark read, and staff contact", async () => {
    const candidate = await seededUser("candidate@hiroapp.com");
    const recruiter = await seededUser("recruiter@hiroapp.com");

    await notifyUser({
      userId: candidate.id,
      type: "App\\Notifications\\ContactUser",
      data: { from: "HiroApp", subject: "inbox" },
    });
    const listed = await inboxService.list(candidate);
    expect(listed.length).toBeGreaterThan(0);
    const unread = listed.find((row) => !row.get("read_at"));
    if (!unread) {
      throw new Error("Expected an unread notification");
    }

    expect(await inboxService.markRead(candidate, "missing-id")).toEqual({ ok: false });
    expect((await inboxService.markRead(candidate, String(unread.id))).ok).toBe(true);
    expect(await inboxService.markRead(candidate, String(unread.id))).toEqual({ ok: false });

    expect(
      await inboxService.contact({
        to: "nobody@hiroapp.com",
        from: recruiter.email,
        subject: "miss",
        text: "gone",
      }),
    ).toEqual({ sent: false });

    const sent = await inboxService.contact({
      to: candidate.email,
      from: recruiter.email,
      subject: "hello",
      text: "pipeline update",
    });
    expect(sent.sent).toBe(true);

    const inbox = await jsonRequest("/api/notify/get", { cookies: candidateCookies });
    expect(inbox.response.status).toBe(200);
    expect(Array.isArray(inbox.body)).toBe(true);

    const marked = await jsonRequest("/api/notify/markasread", {
      cookies: candidateCookies,
      method: "POST",
      body: JSON.stringify({ id: "not-here" }),
    });
    expect(marked.body.message).toBe("error");

    const forbidden = await jsonRequest("/api/notify", {
      cookies: candidateCookies,
      method: "POST",
      body: JSON.stringify({
        to: recruiter.email,
        from: candidate.email,
        subject: "hi",
        text: "nope",
      }),
    });
    expect(forbidden.response.status).toBe(403);

    const contacted = await jsonRequest("/api/notify", {
      cookies: recruiterCookies,
      method: "POST",
      body: JSON.stringify({
        to: candidate.email,
        from: recruiter.email,
        subject: "http",
        text: "staff note",
      }),
    });
    expect(contacted.response.status).toBe(200);

    const primed = await request("/", { cookies: recruiterCookies });
    const html = await request("/notify", {
      cookies: primed.cookies,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-csrf-token": csrfFrom(primed.cookies),
      },
      body: `to=${encodeURIComponent(candidate.email)}&from=${encodeURIComponent(recruiter.email)}&subject=html&text=note&return_to=%2F`,
    });
    expect([302, 303].includes(html.response.status)).toBe(true);
  });
});
