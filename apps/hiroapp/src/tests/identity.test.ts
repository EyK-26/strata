import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { temporarySignedUrl } from "@getstrata/core/http/signedUrl";
import { Application } from "../models/Application.ts";
import { Position } from "../models/Position.ts";
import { tokenService } from "../modules/account/tokenService.ts";
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

describe.skipIf(!enabled)("auth choices and hiring integrations", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl = "";
  let candidateCookies: string[] = [];
  let adminCookies: string[] = [];
  const previousMock = process.env.FEATURE_OAUTH_MOCK;

  beforeAll(async () => {
    process.env.FEATURE_OAUTH_MOCK = "true";
    const boot = await bootHiroapp();
    server = boot.server;
    baseUrl = boot.baseUrl;
    candidateCookies = (await signInCookie("candidate@hiroapp.com")).cookies;
    adminCookies = (await signInCookie("admin@hiroapp.com")).cookies;
  });

  afterAll(() => {
    delete process.env.FEATURE_OAUTH_MOCK;
    delete process.env.FEATURE_EMAIL_VERIFICATION;
    if (previousMock !== undefined) {
      process.env.FEATURE_OAUTH_MOCK = previousMock;
    }
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

  test("HTTP Basic authenticates staff against /api/user", async () => {
    const encoded = Buffer.from("recruiter@hiroapp.com:password").toString("base64");
    const result = await request("/api/user", {
      headers: { authorization: `Basic ${encoded}`, accept: "application/json" },
    });
    expect(result.response.status).toBe(200);
    expect(JSON.parse(result.text).email).toBe("recruiter@hiroapp.com");
  });

  test("opaque token abilities gate the integrations ping", async () => {
    const recruiter = await seededUser("recruiter@hiroapp.com");
    const allowed = await tokenService.createToken(recruiter.id, {
      name: "job-board",
      abilities: ["integrations:ping"],
    });
    const denied = await tokenService.createToken(recruiter.id, {
      name: "read-only",
      abilities: ["profile:read"],
    });
    const ok = await fetch(`${baseUrl}/api/integrations/ping`, {
      headers: { authorization: `Bearer ${allowed.plainTextToken}` },
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, service: "hiroapp" });
    const blocked = await fetch(`${baseUrl}/api/integrations/ping`, {
      headers: { authorization: `Bearer ${denied.plainTextToken}` },
    });
    expect(blocked.status).toBe(403);
    const mintedJwt = await fetch(`${baseUrl}/api/auth/token`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ email: "admin@hiroapp.com", password: "password" }),
    });
    expect(mintedJwt.status).toBe(200);
    const jwtBody = (await mintedJwt.json()) as { token: string };
    const jwtPing = await fetch(`${baseUrl}/api/integrations/ping`, {
      headers: { authorization: `Bearer ${jwtBody.token}` },
    });
    expect(jwtPing.status).toBe(403);
  });

  test("unverified HTML users are sent to confirm their email", async () => {
    const previous = process.env.FEATURE_EMAIL_VERIFICATION;
    process.env.FEATURE_EMAIL_VERIFICATION = "true";
    try {
      const blocked = await request("/account", { cookies: candidateCookies });
      expect(blocked.response.status).toBe(302);
      expect(blocked.response.headers.get("location")).toBe("/email/verify");
      const notice = await request("/email/verify", { cookies: candidateCookies });
      expect(notice.response.status).toBe(200);
      expect(notice.text).toContain("Confirm your email");
      const candidate = await seededUser("candidate@hiroapp.com");
      const signed = temporarySignedUrl("/email/verify", 120, { id: String(candidate.id) });
      const confirmed = await request(signed, { cookies: candidateCookies });
      expect(confirmed.response.status).toBe(302);
      await users.updateById(candidate.id, { email_verified_at: null });
    } finally {
      if (previous === undefined) {
        delete process.env.FEATURE_EMAIL_VERIFICATION;
      } else {
        process.env.FEATURE_EMAIL_VERIFICATION = previous;
      }
    }
  });

  test("candidates can upload a resume as multipart form data", async () => {
    const applied = await Application.withTrashed()
      .where({ user_id: (await seededUser("candidate@hiroapp.com")).id })
      .get();
    const used = new Set(applied.map((row) => Number(row.get("position_id"))));
    const hiring = await Position.where({ hiring: true }).get();
    const open = hiring.find((row) => !used.has(Number(row.id)));
    if (!open) {
      throw new Error("Expected an unused hiring position for resume upload.");
    }
    const primed = await request("/api/skills", { cookies: candidateCookies });
    const token = csrfFrom(primed.cookies);
    const body = new FormData();
    body.set("position_id", String(open.id));
    body.set("resume", new File(["resume text"], "resume.txt", { type: "text/plain" }));
    const response = await fetch(`${baseUrl}/api/applications`, {
      method: "POST",
      headers: {
        cookie: cookieHeader(primed.cookies),
        "x-csrf-token": token,
        accept: "application/json",
      },
      body,
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      attachment_file?: string | null;
      data?: { attachment_file?: string | null };
    };
    const stored = payload.attachment_file ?? payload.data?.attachment_file ?? "";
    expect(String(stored)).toContain("resume");
  });

  test("admins can export hiring audit events for a SIEM", async () => {
    const primed = await request("/api/skills", { cookies: adminCookies });
    const exported = await request("/api/audit-logs/export?format=json", {
      cookies: primed.cookies,
      headers: { accept: "application/json" },
    });
    expect(exported.response.status).toBe(200);
    const body = JSON.parse(exported.text) as { data: Array<{ event_type: string }> };
    expect(Array.isArray(body.data)).toBe(true);
    const cef = await request("/api/audit-logs/export?format=cef", { cookies: primed.cookies });
    expect(cef.response.status).toBe(200);
    expect(cef.response.headers.get("content-type")).toContain("text/plain");
  });

  test("mock SSO creates a candidate session", async () => {
    const start = await request("/auth/oauth/mock");
    expect(start.response.status).toBe(302);
    const location = start.response.headers.get("location") ?? "";
    expect(location).toContain("mock.oauth");
    const state = new URL(location).searchParams.get("state");
    expect(state).toBeTruthy();
    const callback = await request(
      `/auth/oauth/mock/callback?code=valid-code&state=${encodeURIComponent(state ?? "")}`,
      { cookies: start.cookies },
    );
    expect(callback.response.status).toBe(302);
    expect(callback.response.headers.get("location")).toBe("/");
    const created = await users.findByEmail("sso.candidate@hiroapp.com");
    expect(Number(created?.role_id)).toBe(2);
  });
});
