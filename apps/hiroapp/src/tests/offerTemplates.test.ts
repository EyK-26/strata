import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { ForbiddenError, UnprocessableEntityError } from "@getstrata/core/errors/http";
import { STATUS } from "../lib/roles.ts";
import { Application } from "../models/Application.ts";
import { OfferTemplate } from "../models/OfferTemplate.ts";
import { Position } from "../models/Position.ts";
import { offerTemplateService, serializeOfferTemplate } from "../modules/offerTemplates/service.ts";
import {
  bootHiroapp,
  collectCookies,
  cookieHeader,
  csrfFrom,
  seededUser,
  signInCookie,
} from "./helpers.ts";

const enabled = process.env.HIROAPP_TEST === "1";

describe.skipIf(!enabled)("Wave 32 offer templates", () => {
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

  async function openApplication(userId: number) {
    const seat = await Position.create({
      user_id: null,
      department_id: 1,
      grade_id: 1,
      name: `Template Seat ${Date.now()}-${Math.random()}`,
      description: "offer-templates",
      hiring: true,
      start_date: null,
      end_date: null,
    });
    return Application.create({
      user_id: userId,
      position_id: Number(seat.id),
      status_id: STATUS.FEEDBACK,
      attachment_text: null,
      attachment_file: null,
    });
  }

  test("staff create letter templates and apply them to offers", async () => {
    const candidate = await seededUser("candidate@hiroapp.com");
    const recruiter = await seededUser("recruiter@hiroapp.com");

    await expect(offerTemplateService.list(candidate)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      offerTemplateService.create(candidate, { name: "Std", body: "Hello" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      offerTemplateService.create(recruiter, { name: "  ", body: "Hello" }),
    ).rejects.toBeInstanceOf(UnprocessableEntityError);
    await expect(
      offerTemplateService.create(recruiter, { name: "Std", body: "  " }),
    ).rejects.toBeInstanceOf(UnprocessableEntityError);
    await expect(
      offerTemplateService.create(recruiter, { name: "Std", body: "Hello", salary: -5 }),
    ).rejects.toBeInstanceOf(UnprocessableEntityError);

    const created = await offerTemplateService.create(recruiter, {
      name: "  Standard  ",
      body: "  We are pleased to offer you this role.  ",
      salary: 120_000,
    });
    expect(created.name).toBe("Standard");
    expect(created.body).toBe("We are pleased to offer you this role.");
    expect(created.salary).toBe(120_000);
    const model = await OfferTemplate.findOrFail(created.id);
    expect(serializeOfferTemplate(model).name).toBe("Standard");

    const untitled = await offerTemplateService.create(recruiter, {
      name: "No salary",
      body: "Bring your own salary",
    });
    expect(untitled.salary).toBeNull();
    expect(serializeOfferTemplate(untitled).salary).toBeNull();

    await expect(
      offerTemplateService.update(candidate, model, { name: "Nope" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(offerTemplateService.update(recruiter, model, {})).rejects.toBeInstanceOf(
      UnprocessableEntityError,
    );
    const renamed = await offerTemplateService.update(recruiter, model, { name: "Senior" });
    expect(renamed.name).toBe("Senior");
    const rewritten = await offerTemplateService.update(
      recruiter,
      await OfferTemplate.findOrFail(created.id),
      { body: "Updated letter" },
    );
    expect(rewritten.body).toBe("Updated letter");
    const cleared = await offerTemplateService.update(
      recruiter,
      await OfferTemplate.findOrFail(created.id),
      { salary: null },
    );
    expect(cleared.salary).toBeNull();
    const restored = await offerTemplateService.update(
      recruiter,
      await OfferTemplate.findOrFail(created.id),
      { salary: 130_000 },
    );
    expect(restored.salary).toBe(130_000);

    await expect(
      offerTemplateService.materialize(candidate, await OfferTemplate.findOrFail(created.id)),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      offerTemplateService.materialize(recruiter, await OfferTemplate.findOrFail(untitled.id)),
    ).rejects.toBeInstanceOf(UnprocessableEntityError);
    await expect(
      offerTemplateService.materialize(recruiter, await OfferTemplate.findOrFail(untitled.id), {
        salary: 0,
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityError);
    const fromStored = await offerTemplateService.materialize(
      recruiter,
      await OfferTemplate.findOrFail(created.id),
    );
    expect(fromStored).toEqual({ salary: 130_000, notes: "Updated letter" });
    const overridden = await offerTemplateService.materialize(
      recruiter,
      await OfferTemplate.findOrFail(created.id),
      { salary: 140_000, notes: "  custom note  " },
    );
    expect(overridden).toEqual({ salary: 140_000, notes: "custom note" });
    const withSalaryOnBlank = await offerTemplateService.materialize(
      recruiter,
      await OfferTemplate.findOrFail(untitled.id),
      { salary: 90_000 },
    );
    expect(withSalaryOnBlank.salary).toBe(90_000);
    expect(withSalaryOnBlank.notes).toBe("Bring your own salary");

    const listed = await offerTemplateService.list(recruiter);
    expect(listed.some((row) => row.id === created.id)).toBe(true);

    await expect(
      offerTemplateService.remove(candidate, await OfferTemplate.findOrFail(untitled.id)),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const removed = await offerTemplateService.remove(
      recruiter,
      await OfferTemplate.findOrFail(untitled.id),
    );
    expect(removed.id).toBe(untitled.id);

    const forbidden = await jsonRequest("/api/offer-templates", { cookies: candidateCookies });
    expect(forbidden.response.status).toBe(403);
    const httpCreated = await jsonRequest("/api/offer-templates", {
      cookies: recruiterCookies,
      method: "POST",
      body: JSON.stringify({ name: "HTTP", body: "HTTP body", salary: 110_000 }),
    });
    expect(httpCreated.response.status).toBe(200);
    expect(httpCreated.body.name).toBe("HTTP");
    const listedHttp = await jsonRequest("/api/offer-templates", { cookies: recruiterCookies });
    expect(listedHttp.body.some((row: { id: number }) => row.id === httpCreated.body.id)).toBe(
      true,
    );
    const updatedHttp = await jsonRequest(`/api/offer-templates/${httpCreated.body.id}/update`, {
      cookies: recruiterCookies,
      method: "POST",
      body: JSON.stringify({ body: "HTTP updated" }),
    });
    expect(updatedHttp.body.body).toBe("HTTP updated");
    const application = await openApplication(candidate.id);
    const fromTemplate = await jsonRequest(
      `/api/applications/${application.id}/offers/from-template`,
      {
        cookies: recruiterCookies,
        method: "POST",
        body: JSON.stringify({ template_id: httpCreated.body.id }),
      },
    );
    expect(fromTemplate.response.status).toBe(200);
    expect(fromTemplate.body.salary).toBe(110_000);
    expect(fromTemplate.body.notes).toBe("HTTP updated");
    const deletedHttp = await jsonRequest(`/api/offer-templates/${httpCreated.body.id}/delete`, {
      cookies: recruiterCookies,
      method: "POST",
    });
    expect(deletedHttp.body.id).toBe(httpCreated.body.id);

    const primed = await request("/offer-templates", { cookies: recruiterCookies });
    expect(primed.response.status).toBe(200);
    expect(primed.text.includes("Offer templates")).toBe(true);
    const htmlCreate = await request("/offer-templates", {
      cookies: primed.cookies,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-csrf-token": csrfFrom(primed.cookies),
      },
      body: "name=HTML&body=HTML+letter&salary=100000",
    });
    expect([302, 303].includes(htmlCreate.response.status)).toBe(true);
    const htmlListed = await offerTemplateService.list(recruiter);
    const htmlTemplate = htmlListed.find((row) => row.name === "HTML");
    if (!htmlTemplate) {
      throw new Error("missing html template");
    }
    const updatePage = await request("/offer-templates", { cookies: recruiterCookies });
    const htmlUpdate = await request(`/offer-templates/${htmlTemplate.id}/update`, {
      cookies: updatePage.cookies,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-csrf-token": csrfFrom(updatePage.cookies),
      },
      body: "name=HTML&body=HTML+updated",
    });
    expect([302, 303].includes(htmlUpdate.response.status)).toBe(true);
    const htmlApp = await openApplication(candidate.id);
    const appPage = await request(`/applications/${htmlApp.id}`, { cookies: recruiterCookies });
    const htmlOffer = await request(`/applications/${htmlApp.id}/offers`, {
      cookies: appPage.cookies,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-csrf-token": csrfFrom(appPage.cookies),
      },
      body: `template_id=${htmlTemplate.id}&return_to=/applications/${htmlApp.id}`,
    });
    expect([302, 303].includes(htmlOffer.response.status)).toBe(true);
    const deletePage = await request("/offer-templates", { cookies: recruiterCookies });
    const htmlDelete = await request(`/offer-templates/${htmlTemplate.id}/delete`, {
      cookies: deletePage.cookies,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-csrf-token": csrfFrom(deletePage.cookies),
      },
      body: "return_to=/offer-templates",
    });
    expect([302, 303].includes(htmlDelete.response.status)).toBe(true);
  });
});
