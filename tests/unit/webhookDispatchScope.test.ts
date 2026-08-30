import { describe, expect, test } from "bun:test";
import { runWithMigrationBypass } from "@getstrata/core/tenant/databaseTenantContext";
import {
  matchesWebhookOrganization,
  organizationIdFromWebhookPayload,
  resolveWebhookOrganizationId,
} from "../../src/modules/webhook/dispatchScope";

describe("webhook dispatch scope", () => {
  test("matchesWebhookOrganization treats null as tenant-wide", () => {
    expect(matchesWebhookOrganization(null, 1)).toBe(true);
    expect(matchesWebhookOrganization(null, null)).toBe(true);
    expect(matchesWebhookOrganization(2, 2)).toBe(true);
    expect(matchesWebhookOrganization(2, 3)).toBe(false);
    expect(matchesWebhookOrganization(2, null)).toBe(false);
  });

  test("organizationIdFromWebhookPayload reads nested model payloads", () => {
    expect(organizationIdFromWebhookPayload({ organization_id: 4 })).toBe(4);
    expect(organizationIdFromWebhookPayload({ organization_id: "5" })).toBe(5);
    expect(organizationIdFromWebhookPayload({ payload: { organization_id: 6 } })).toBe(6);
    expect(
      organizationIdFromWebhookPayload({
        table: "organization",
        payload: { id: 1, name: "Acme Labs" },
      }),
    ).toBe(1);
    expect(organizationIdFromWebhookPayload({ table: "organization", id: 2 })).toBe(2);
    expect(organizationIdFromWebhookPayload({ table: "task", payload: { id: 9 } })).toBeNull();
    expect(organizationIdFromWebhookPayload({ organization_id: 0 })).toBeNull();
    expect(organizationIdFromWebhookPayload({ organization_id: "nope" })).toBeNull();
    expect(organizationIdFromWebhookPayload({ payload: ["not-an-object"] })).toBeNull();
    expect(organizationIdFromWebhookPayload({ payload: null })).toBeNull();
  });

  test("resolveWebhookOrganizationId looks up project and task orgs", async () => {
    await runWithMigrationBypass(async () => {
      expect(await resolveWebhookOrganizationId({ organization_id: 9 })).toBe(9);
      expect(
        await resolveWebhookOrganizationId({
          table: "task",
          payload: { id: 1, project_id: 1 },
        }),
      ).toBe(1);
      expect(
        await resolveWebhookOrganizationId({
          table: "task",
          payload: { id: 4, project_id: 3 },
        }),
      ).toBe(2);
      expect(await resolveWebhookOrganizationId({ project_id: 3 })).toBe(2);
      expect(
        await resolveWebhookOrganizationId({
          table: "comment",
          payload: { id: 1, task_id: 1 },
        }),
      ).toBe(1);
      expect(await resolveWebhookOrganizationId({ task_id: 4 })).toBe(2);
      expect(await resolveWebhookOrganizationId({ project_id: 999_999 })).toBeNull();
      expect(await resolveWebhookOrganizationId({ task_id: 999_999 })).toBeNull();
      expect(await resolveWebhookOrganizationId({ id: 99 })).toBeNull();
    });
  });
});
