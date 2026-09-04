import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { bootHiroapp, collectCookies, cookieHeader, csrfFrom, signInCookie } from "./helpers.ts";

const enabled = process.env.HIROAPP_TEST === "1";
const scimToken = process.env.SCIM_BEARER_TOKEN ?? "hiroapp-scim-test-token";
const stripeSecret = process.env.STRIPE_WEBHOOK_SECRET ?? "whsec_hiroapp_test";

describe.skipIf(!enabled)("Wave 9 staff SCIM webhooks audit billing", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl = "";
  let candidateCookies: string[] = [];
  let recruiterCookies: string[] = [];
  let adminCookies: string[] = [];

  beforeAll(async () => {
    const boot = await bootHiroapp();
    server = boot.server;
    baseUrl = boot.baseUrl;
    candidateCookies = (await signInCookie("candidate@hiroapp.com")).cookies;
    recruiterCookies = (await signInCookie("recruiter@hiroapp.com")).cookies;
    adminCookies = (await signInCookie("admin@hiroapp.com")).cookies;
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

  async function scim(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${scimToken}`);
    if (init.method && init.method !== "GET" && !headers.has("content-type")) {
      headers.set("content-type", "application/scim+json");
    }
    const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
    const text = await response.text();
    return { response, body: text ? JSON.parse(text) : null };
  }

  test("SCIM lists staff and ignores candidates", async () => {
    const config = await scim("/scim/v2/ServiceProviderConfig");
    expect(config.response.status).toBe(200);
    expect(config.body.patch.supported).toBe(true);

    const listed = await scim("/scim/v2/Users");
    expect(listed.response.status).toBe(200);
    const emails = listed.body.Resources.map((row: { userName: string }) => row.userName);
    expect(emails).toContain("admin@hiroapp.com");
    expect(emails).toContain("recruiter@hiroapp.com");
    expect(emails).not.toContain("candidate@hiroapp.com");

    const ignored = await scim("/scim/v2/Users", {
      method: "POST",
      body: JSON.stringify({
        userName: `applicant.${Date.now()}@hiroapp.com`,
        name: { formatted: "Pat Applicant" },
        userType: "candidate",
      }),
    });
    expect(ignored.response.status).toBe(400);
  });

  test("SCIM provisions staff and maps groups to departments", async () => {
    const email = `scim.staff.${Date.now()}@hiroapp.com`;
    const created = await scim("/scim/v2/Users", {
      method: "POST",
      body: JSON.stringify({
        userName: email,
        name: { givenName: "Scim", familyName: "Recruiter" },
        roles: [{ value: "recruiter" }],
      }),
    });
    expect(created.response.status).toBe(201);
    expect(created.body.userName).toBe(email);
    expect(created.body.roles[0].value).toBe("recruiter");

    const groups = await scim("/scim/v2/Groups");
    expect(groups.response.status).toBe(200);
    const engineering = groups.body.Resources.find((row: { displayName: string }) =>
      String(row.displayName).includes("Engineering"),
    );
    expect(engineering).toBeTruthy();

    const patched = await scim(`/scim/v2/Groups/${engineering.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        Operations: [{ op: "add", path: "members", value: [{ value: created.body.id }] }],
      }),
    });
    expect(patched.response.status).toBe(200);
    expect(
      patched.body.members.some((member: { value: string }) => member.value === created.body.id),
    ).toBe(true);
  });

  test("candidates cannot manage webhooks; staff can create hiring webhooks", async () => {
    const denied = await jsonRequest("/api/webhooks", { cookies: candidateCookies });
    expect(denied.response.status).toBe(403);

    const created = await jsonRequest("/api/webhooks", {
      cookies: recruiterCookies,
      method: "POST",
      body: JSON.stringify({
        url: "https://example.com/hiroapp-hooks",
        secret: "hook-secret",
        events: ["application.submitted"],
      }),
    });
    expect(created.response.status).toBe(201);
    expect(created.body.url).toBe("https://example.com/hiroapp-hooks");

    const listed = await jsonRequest("/api/webhooks", { cookies: recruiterCookies });
    expect(listed.body.some((row: { id: number }) => row.id === created.body.id)).toBe(true);

    const deleted = await jsonRequest(`/api/webhooks/${created.body.id}`, {
      cookies: recruiterCookies,
      method: "DELETE",
    });
    expect(deleted.response.status).toBe(200);
    expect(deleted.body.deleted).toBe(true);
  });

  test("admin can read audit logs and billing, candidates cannot", async () => {
    const billing = await jsonRequest("/api/billing/subscription", { cookies: adminCookies });
    expect(billing.response.status).toBe(200);
    expect(billing.body.tenant_id).toBe(1);
    expect(billing.body.subscription.plan).toBe("enterprise");

    const candidateBilling = await jsonRequest("/api/billing/subscription", {
      cookies: candidateCookies,
    });
    expect(candidateBilling.response.status).toBe(403);

    const logs = await jsonRequest("/api/audit-logs", { cookies: adminCookies });
    expect(logs.response.status).toBe(200);
    expect(Array.isArray(logs.body)).toBe(true);

    const recruiterLogs = await jsonRequest("/api/audit-logs", { cookies: recruiterCookies });
    expect(recruiterLogs.response.status).toBe(403);
  });

  test("Stripe billing webhook upserts the tenant subscription", async () => {
    const rawBody = JSON.stringify({
      id: `evt_${Date.now()}`,
      type: "customer.subscription.updated",
      data: { object: { metadata: { tenant_id: "1" }, status: "active" } },
    });
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = createHmac("sha256", stripeSecret)
      .update(`${timestamp}.${rawBody}`, "utf8")
      .digest("hex");
    const response = await fetch(`${baseUrl}/billing/webhooks/stripe`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "stripe-signature": `t=${timestamp},v1=${signature}`,
      },
      body: rawBody,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.received).toBe(true);

    const billing = await jsonRequest("/api/billing/subscription", { cookies: adminCookies });
    expect(billing.body.subscription.plan).toBe("pro");
    expect(billing.body.subscription.status).toBe("active");
  });

  test("HTML staff pages render webhooks, audit, and billing", async () => {
    const webhooks = await request("/webhooks", { cookies: adminCookies });
    expect(webhooks.response.status).toBe(200);
    expect(webhooks.text).toContain("Hiring webhooks");

    const audit = await request("/audit-logs", { cookies: adminCookies });
    expect(audit.response.status).toBe(200);
    expect(audit.text).toContain("Audit log");

    const billing = await request("/billing", { cookies: recruiterCookies });
    expect(billing.response.status).toBe(200);
    expect(billing.text).toContain("Billing");

    const candidatePage = await request("/webhooks", { cookies: candidateCookies });
    expect(candidatePage.response.status).toBe(403);
  });
});
