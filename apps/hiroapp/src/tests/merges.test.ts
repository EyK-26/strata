import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { hashPassword } from "@getstrata/core/auth/password";
import { ForbiddenError, UnprocessableEntityError } from "@getstrata/core/errors/http";
import { ROLE, STATUS } from "../lib/roles.ts";
import { Application } from "../models/Application.ts";
import { CandidateMerge } from "../models/CandidateMerge.ts";
import { Position } from "../models/Position.ts";
import { TalentPoolEntry } from "../models/TalentPoolEntry.ts";
import { mergeService, serializeMerge } from "../modules/merges/service.ts";
import { talentPool } from "../modules/pool/repository.ts";
import { talentPoolService } from "../modules/pool/service.ts";
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

describe.skipIf(!enabled)("Wave 37 duplicate-candidate merge", () => {
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
      name: `Merge Seat ${Date.now()}-${Math.random()}`,
      description: "merge",
      hiring: true,
      start_date: null,
      end_date: null,
    });
  }

  async function makeCandidate(label: string) {
    return users.create({
      first_name: "Merge",
      last_name: label,
      email: `merge.${label}.${Date.now()}@hiroapp.com`,
      password: await hashPassword("password"),
      role_id: ROLE.CANDIDATE,
    });
  }

  async function apply(userId: number, positionId: number) {
    return Application.create({
      user_id: userId,
      position_id: positionId,
      status_id: STATUS.APPLIED,
      attachment_text: null,
      attachment_file: null,
    });
  }

  test("staff merge duplicate candidates without deleting the source user", async () => {
    const recruiter = await seededUser("recruiter@hiroapp.com");
    const candidate = await seededUser("candidate@hiroapp.com");
    const source = await makeCandidate("source");
    const target = await makeCandidate("target");
    const uniqueSeat = await openSeat();
    const conflictSeat = await openSeat();
    const movedApp = await apply(source.id, Number(uniqueSeat.id));
    const skippedApp = await apply(source.id, Number(conflictSeat.id));
    await apply(target.id, Number(conflictSeat.id));

    await expect(mergeService.list(candidate)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      mergeService.merge(candidate, { source_id: source.id, target_id: target.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      mergeService.merge(recruiter, { source_id: source.id, target_id: source.id }),
    ).rejects.toBeInstanceOf(UnprocessableEntityError);
    await expect(
      mergeService.merge(recruiter, { source_id: 0, target_id: target.id }),
    ).rejects.toBeInstanceOf(UnprocessableEntityError);
    await expect(
      mergeService.merge(recruiter, { source_id: 9_999_999, target_id: target.id }),
    ).rejects.toBeInstanceOf(UnprocessableEntityError);
    await expect(
      mergeService.merge(recruiter, { source_id: source.id, target_id: 9_999_999 }),
    ).rejects.toBeInstanceOf(UnprocessableEntityError);
    await expect(
      mergeService.merge(recruiter, { source_id: recruiter.id, target_id: target.id }),
    ).rejects.toBeInstanceOf(UnprocessableEntityError);
    await expect(
      mergeService.merge(recruiter, { source_id: source.id, target_id: recruiter.id }),
    ).rejects.toBeInstanceOf(UnprocessableEntityError);

    const merged = await mergeService.merge(recruiter, {
      source_id: source.id,
      target_id: target.id,
    });
    expect(merged.applications_moved).toBe(1);
    expect(merged.applications_skipped).toBe(1);
    expect(merged.pool_action).toBe("unchanged");
    expect(await users.findById(source.id)).toBeTruthy();
    expect(Number((await Application.findOrFail(movedApp.id)).get("user_id"))).toBe(target.id);
    expect(Number((await Application.findOrFail(skippedApp.id)).get("user_id"))).toBe(source.id);
    const model = await CandidateMerge.findOrFail(merged.id);
    expect(serializeMerge(model).source_user_id).toBe(source.id);
    expect(serializeMerge({ ...merged, pool_action: "nope" as never }).pool_action).toBe(
      "unchanged",
    );

    const retargetSource = await makeCandidate("pool-source");
    const retargetTarget = await makeCandidate("pool-target");
    await talentPoolService.add(recruiter, { user_id: retargetSource.id, notes: "keep" });
    const retargeted = await mergeService.merge(recruiter, {
      source_id: retargetSource.id,
      target_id: retargetTarget.id,
    });
    expect(retargeted.pool_action).toBe("retargeted");
    expect((await talentPool.findByUser(retargetTarget.id))?.user_id).toBe(retargetTarget.id);

    const releaseSource = await makeCandidate("release-source");
    const releaseTarget = await makeCandidate("release-target");
    await talentPoolService.add(recruiter, { user_id: releaseSource.id });
    await talentPoolService.add(recruiter, { user_id: releaseTarget.id });
    const released = await mergeService.merge(recruiter, {
      source_id: releaseSource.id,
      target_id: releaseTarget.id,
    });
    expect(released.pool_action).toBe("released_source");
    expect((await talentPool.findByUser(releaseSource.id))?.status).toBe("released");
    expect((await talentPool.findByUser(releaseTarget.id))?.status).toBe("active");

    const keptSource = await makeCandidate("kept-source");
    const keptTarget = await makeCandidate("kept-target");
    await talentPoolService.add(recruiter, { user_id: keptSource.id });
    await talentPoolService.add(recruiter, { user_id: keptTarget.id });
    const sourceEntry = await talentPool.findByUser(keptSource.id);
    if (!sourceEntry) {
      throw new Error("missing source pool row");
    }
    await talentPoolService.release(recruiter, await TalentPoolEntry.findOrFail(sourceEntry.id));
    const kept = await mergeService.merge(recruiter, {
      source_id: keptSource.id,
      target_id: keptTarget.id,
    });
    expect(kept.pool_action).toBe("kept_target");

    const listed = await mergeService.list(recruiter);
    expect(listed.some((row) => row.id === merged.id)).toBe(true);

    const httpSource = await makeCandidate("http-source");
    const httpTarget = await makeCandidate("http-target");
    const forbidden = await jsonRequest("/api/merges", {
      cookies: candidateCookies,
      method: "POST",
      body: JSON.stringify({ source_id: httpSource.id, target_id: httpTarget.id }),
    });
    expect(forbidden.response.status).toBe(403);
    const created = await jsonRequest("/api/merges", {
      cookies: recruiterCookies,
      method: "POST",
      body: JSON.stringify({ source_id: httpSource.id, target_id: httpTarget.id }),
    });
    expect(created.body.pool_action).toBe("unchanged");
    const listedHttp = await jsonRequest("/api/merges", { cookies: recruiterCookies });
    expect(listedHttp.body.some((row: { id: number }) => row.id === created.body.id)).toBe(true);

    const htmlSource = await makeCandidate("html-source");
    const htmlTarget = await makeCandidate("html-target");
    const page = await request("/merges", { cookies: recruiterCookies });
    expect(page.response.status).toBe(200);
    expect(page.text.includes("Candidate merges")).toBe(true);
    const htmlMerge = await request("/merges", {
      cookies: page.cookies,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-csrf-token": csrfFrom(page.cookies),
      },
      body: `source_id=${htmlSource.id}&target_id=${htmlTarget.id}&return_to=/merges`,
    });
    expect([302, 303].includes(htmlMerge.response.status)).toBe(true);
  });
});
