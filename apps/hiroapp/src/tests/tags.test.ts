import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { hashPassword } from "@getstrata/core/auth/password";
import {
  ConflictError,
  ForbiddenError,
  UnprocessableEntityError,
} from "@getstrata/core/errors/http";
import { ROLE } from "../lib/roles.ts";
import { CandidateTag } from "../models/CandidateTag.ts";
import { User } from "../models/User.ts";
import { serializeTag, tagService } from "../modules/tags/service.ts";
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

describe.skipIf(!enabled)("Wave 39 candidate tags", () => {
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

  async function makeCandidate(label: string) {
    return users.create({
      first_name: "Tagged",
      last_name: label,
      email: `tag.${label}.${Date.now()}@hiroapp.com`,
      password: await hashPassword("password"),
      role_id: ROLE.CANDIDATE,
    });
  }

  test("staff tag candidates; owners can view their labels", async () => {
    const recruiter = await seededUser("recruiter@hiroapp.com");
    const candidate = await seededUser("candidate@hiroapp.com");
    const other = await makeCandidate("other");
    const recruiterModel = await User.findOrFail(recruiter.id);
    const candidateModel = await User.findOrFail(candidate.id);
    const otherModel = await User.findOrFail(other.id);

    expect(await tagService.listForUser(recruiter, candidateModel)).toEqual([]);
    expect(await tagService.listForUser(candidate, candidateModel)).toEqual([]);
    await expect(tagService.list(candidate)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(tagService.listForUser(other, candidateModel)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      tagService.add(candidate, candidateModel, { label: "vip" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      tagService.add(recruiter, recruiterModel, { label: "vip" }),
    ).rejects.toBeInstanceOf(UnprocessableEntityError);
    await expect(
      tagService.add(recruiter, candidateModel, { label: "   " }),
    ).rejects.toBeInstanceOf(UnprocessableEntityError);

    const created = await tagService.add(recruiter, candidateModel, { label: "  senior  " });
    expect(created.label).toBe("senior");
    const model = await CandidateTag.findOrFail(created.id);
    expect(serializeTag(model).label).toBe("senior");
    expect(
      (await candidateModel.candidateTags()).some((row) => Number(row.id) === created.id),
    ).toBe(true);
    await expect(
      tagService.add(recruiter, candidateModel, { label: "senior" }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      tagService.remove(candidate, await CandidateTag.findOrFail(created.id)),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const listed = await tagService.listForUser(candidate, candidateModel);
    expect(listed.some((row) => row.id === created.id && row.label === "senior")).toBe(true);
    expect((await tagService.list(recruiter)).some((row) => row.id === created.id)).toBe(true);

    const removed = await tagService.remove(recruiter, await CandidateTag.findOrFail(created.id));
    expect(removed.label).toBe("senior");
    expect(await tagService.listForUser(recruiter, candidateModel)).toEqual([]);

    const httpUser = await makeCandidate("http");
    const forbidden = await jsonRequest(`/api/users/${httpUser.id}/tags`, {
      cookies: candidateCookies,
      method: "POST",
      body: JSON.stringify({ label: "vip" }),
    });
    expect(forbidden.response.status).toBe(403);
    const empty = await jsonRequest(`/api/users/${httpUser.id}/tags`, {
      cookies: recruiterCookies,
    });
    expect(empty.body).toEqual([]);
    const httpCreated = await jsonRequest(`/api/users/${httpUser.id}/tags`, {
      cookies: recruiterCookies,
      method: "POST",
      body: JSON.stringify({ label: "referral" }),
    });
    expect(httpCreated.body.label).toBe("referral");
    const httpDeleted = await jsonRequest(`/api/tags/${httpCreated.body.id}/delete`, {
      cookies: recruiterCookies,
      method: "POST",
    });
    expect(httpDeleted.body.label).toBe("referral");

    const htmlUser = await makeCandidate("html");
    const page = await request(`/users/${htmlUser.id}`, { cookies: recruiterCookies });
    expect(page.response.status).toBe(200);
    const htmlAdd = await request(`/users/${htmlUser.id}/tags`, {
      cookies: page.cookies,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-csrf-token": csrfFrom(page.cookies),
      },
      body: `label=html-tag&return_to=/users/${htmlUser.id}`,
    });
    expect([302, 303].includes(htmlAdd.response.status)).toBe(true);
    const htmlTags = await tagService.listForUser(recruiter, await User.findOrFail(htmlUser.id));
    expect(htmlTags).toHaveLength(1);
    const deletePage = await request(`/users/${htmlUser.id}`, { cookies: recruiterCookies });
    const htmlDelete = await request(`/tags/${htmlTags[0].id}/delete`, {
      cookies: deletePage.cookies,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-csrf-token": csrfFrom(deletePage.cookies),
      },
      body: `return_to=/users/${htmlUser.id}`,
    });
    expect([302, 303].includes(htmlDelete.response.status)).toBe(true);
    expect(await tagService.listForUser(recruiter, otherModel)).toEqual([]);

    const indexUser = await makeCandidate("index");
    const tagsPage = await request("/tags", { cookies: recruiterCookies });
    expect(tagsPage.response.status).toBe(200);
    expect(tagsPage.text.includes("Candidate tags")).toBe(true);
    const htmlIndexAdd = await request("/tags", {
      cookies: tagsPage.cookies,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-csrf-token": csrfFrom(tagsPage.cookies),
      },
      body: `user_id=${indexUser.id}&label=board&return_to=/tags`,
    });
    expect([302, 303].includes(htmlIndexAdd.response.status)).toBe(true);
  });
});
