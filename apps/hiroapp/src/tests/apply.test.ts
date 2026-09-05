import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { signJwt } from "@getstrata/core/auth/jwt";
import { ApplicationResource } from "../http/resources.ts";
import { STATUS } from "../lib/roles.ts";
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

  async function expectStatus(response: Response, status: number) {
    if (response.status !== status) {
      const body = await response.clone().text();
      throw new Error(
        `expected ${status}, got ${response.status} for ${response.url}: ${body.slice(0, 500)}`,
      );
    }
    expect(response.status).toBe(status);
  }

  test("staff and JWT cannot use the apply portal; candidates mint an opaque token", async () => {
    const staffLogin = await fetch(`${baseUrl}/api/apply/login`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ email: "recruiter@hiroapp.com", password: "password" }),
    });
    await expectStatus(staffLogin, 403);

    const bad = await fetch(`${baseUrl}/api/apply/login`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ email: "candidate@hiroapp.com", password: "wrong" }),
    });
    await expectStatus(bad, 422);

    const minted = await fetch(`${baseUrl}/api/apply/login`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ email: "candidate@hiroapp.com", password: "password" }),
    });
    await expectStatus(minted, 200);
    const payload = (await minted.json()) as {
      token: string;
      token_type: string;
      abilities: string[];
    };
    expect(payload.token_type).toBe("Bearer");
    expect(payload.abilities).toContain("applications:write");

    const auth = { authorization: `Bearer ${payload.token}`, accept: "application/json" };
    const me = await fetch(`${baseUrl}/api/apply/me`, { headers: auth });
    await expectStatus(me, 200);
    expect(((await me.json()) as { email: string }).email).toBe("candidate@hiroapp.com");

    const cookieBlocked = await request("/api/apply/me", {
      cookies: staffCookies,
      headers: { accept: "application/json" },
    });
    await expectStatus(cookieBlocked.response, 403);

    const candidate = await seededUser("candidate@hiroapp.com");
    const jwt = signJwt({
      sub: Number(candidate.id),
      role: "candidate",
      abilities: ["interviews:join"],
    });
    const jwtBlocked = await fetch(`${baseUrl}/api/apply/me`, {
      headers: { authorization: `Bearer ${jwt}`, accept: "application/json" },
    });
    await expectStatus(jwtBlocked, 403);

    const positions = await fetch(`${baseUrl}/api/apply/positions`, { headers: auth });
    await expectStatus(positions, 200);

    const listed = await fetch(`${baseUrl}/api/apply/applications`, { headers: auth });
    await expectStatus(listed, 200);

    const interviews = await fetch(`${baseUrl}/api/apply/interviews`, { headers: auth });
    await expectStatus(interviews, 200);

    const offers = await fetch(`${baseUrl}/api/apply/offers`, { headers: auth });
    await expectStatus(offers, 200);

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
      await expectStatus(applied, 200);
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
    await expectStatus(profile, 200);

    const loggedOut = await fetch(`${baseUrl}/api/apply/logout`, {
      method: "POST",
      headers: auth,
    });
    await expectStatus(loggedOut, 200);
    expect(await loggedOut.json()).toEqual({ revoked: true });

    const after = await fetch(`${baseUrl}/api/apply/me`, { headers: auth });
    await expectStatus(after, 401);
  });

  test("ApplicationResource serializes a loaded-null position as null", () => {
    const application = {
      id: 8,
      user_id: 2,
      position_id: null,
      status_id: STATUS.APPLIED,
      attachment_text: null,
      attachment_file: null,
      loaded(name: string) {
        if (name === "position") {
          return null;
        }
        return undefined;
      },
    };
    const payload = new ApplicationResource(application).toArray();
    expect(payload.position_id).toBeNull();
    expect(payload.position).toBeNull();
    expect(payload.status).toBeUndefined();
  });

  test("apply service lists candidate applications whose position is missing", async () => {
    const candidate = await seededUser("candidate@hiroapp.com");
    await Application.create({
      user_id: candidate.id,
      position_id: null,
      status_id: STATUS.APPLIED,
      attachment_text: "no seat",
      attachment_file: null,
    });
    const listed = await applyService.applications(candidate);
    expect(listed.some((row) => row.position_id === null && row.position === null)).toBe(true);
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
