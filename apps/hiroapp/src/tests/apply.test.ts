import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { signJwt } from "@getstrata/core/auth/jwt";
import { Application } from "../models/Application.ts";
import { Position } from "../models/Position.ts";
import { applyService } from "../modules/apply/service.ts";
import { bootHiroapp, collectCookies, cookieHeader, seededUser, signInCookie } from "./helpers.ts";

const enabled = process.env.HIROAPP_TEST === "1";

describe.skipIf(!enabled)("candidate apply portal", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl = "";
  let staffCookies: string[] = [];

  beforeAll(async () => {
    const boot = await bootHiroapp();
    server = boot.server;
    baseUrl = boot.baseUrl;
    staffCookies = (await signInCookie("recruiter@hiroapp.com")).cookies;
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

  test("hybrid keeps staff HTML and mounts the apply SPA prefix", async () => {
    const login = await request("/login");
    expect(login.response.status).toBe(200);
    expect(login.text).toContain("Candidate portal");
    const spa = await request("/apply");
    expect([200, 503]).toContain(spa.response.status);
  });

  test("staff and JWT cannot use the apply portal; candidates mint an opaque token", async () => {
    const staffLogin = await fetch(`${baseUrl}/api/apply/login`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ email: "recruiter@hiroapp.com", password: "password" }),
    });
    expect(staffLogin.status).toBe(403);

    const bad = await fetch(`${baseUrl}/api/apply/login`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ email: "candidate@hiroapp.com", password: "wrong" }),
    });
    expect(bad.status).toBe(422);

    const minted = await fetch(`${baseUrl}/api/apply/login`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ email: "candidate@hiroapp.com", password: "password" }),
    });
    expect(minted.status).toBe(200);
    const payload = (await minted.json()) as {
      token: string;
      token_type: string;
      abilities: string[];
    };
    expect(payload.token_type).toBe("Bearer");
    expect(payload.abilities).toContain("applications:write");

    const auth = { authorization: `Bearer ${payload.token}`, accept: "application/json" };
    const me = await fetch(`${baseUrl}/api/apply/me`, { headers: auth });
    expect(me.status).toBe(200);
    expect(((await me.json()) as { email: string }).email).toBe("candidate@hiroapp.com");

    const cookieBlocked = await request("/api/apply/me", {
      cookies: staffCookies,
      headers: { accept: "application/json" },
    });
    expect(cookieBlocked.response.status).toBe(403);

    const candidate = await seededUser("candidate@hiroapp.com");
    const jwt = signJwt({
      sub: Number(candidate.id),
      role: "candidate",
      abilities: ["interviews:join"],
    });
    const jwtBlocked = await fetch(`${baseUrl}/api/apply/me`, {
      headers: { authorization: `Bearer ${jwt}`, accept: "application/json" },
    });
    expect(jwtBlocked.status).toBe(403);

    const positions = await fetch(`${baseUrl}/api/apply/positions`, { headers: auth });
    expect(positions.status).toBe(200);

    const listed = await fetch(`${baseUrl}/api/apply/applications`, { headers: auth });
    expect(listed.status).toBe(200);

    const interviews = await fetch(`${baseUrl}/api/apply/interviews`, { headers: auth });
    expect(interviews.status).toBe(200);

    const offers = await fetch(`${baseUrl}/api/apply/offers`, { headers: auth });
    expect(offers.status).toBe(200);

    const used = new Set(
      (await Application.withTrashed().where({ user_id: candidate.id }).get()).map((row) =>
        Number(row.get("position_id")),
      ),
    );
    const hiring = await Position.where({ hiring: true }).get();
    const open = hiring.find((row) => !used.has(Number(row.id)));
    if (open) {
      const applied = await fetch(`${baseUrl}/api/apply/applications`, {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({
          position_id: Number(open.id),
          attachment_text: "portal cover",
          attachment_file: null,
        }),
      });
      expect(applied.status).toBe(200);
    }

    const profile = await fetch(`${baseUrl}/api/apply/profile`, {
      method: "PATCH",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({
        first_name: candidate.first_name,
        last_name: candidate.last_name,
        email: candidate.email,
      }),
    });
    expect(profile.status).toBe(200);

    const loggedOut = await fetch(`${baseUrl}/api/apply/logout`, {
      method: "POST",
      headers: auth,
    });
    expect(loggedOut.status).toBe(200);
    expect(await loggedOut.json()).toEqual({ revoked: true });

    const after = await fetch(`${baseUrl}/api/apply/me`, { headers: auth });
    expect(after.status).toBe(401);
  });

  test("apply service logout without a token row is a no-op", async () => {
    expect(await applyService.logout()).toEqual({ revoked: false });
    expect(await applyService.logout(9_999_999)).toEqual({ revoked: false });
  });

  test("apply service records an application on an open seat", async () => {
    const candidate = await seededUser("candidate@hiroapp.com");
    const seat = await Position.create({
      user_id: null,
      department_id: 1,
      grade_id: 1,
      name: `Portal Seat ${Date.now()}`,
      description: "hybrid",
      hiring: true,
      start_date: null,
      end_date: null,
    });
    const created = await applyService.apply(candidate, {
      position_id: Number(seat.id),
      attachment_text: "portal cover",
      attachment_file: null,
    });
    expect(created).toBeTruthy();
  });
});
