import { describe, expect, mock, test } from "bun:test";
import { BadRequestError } from "@getstrata/core/errors/http";
import { resolveHtmlWebhookOrganizationId } from "../../src/modules/webhook/htmlOrganization";

describe("resolveHtmlWebhookOrganizationId", () => {
  test("keeps an explicit form organization id", async () => {
    const currentForUser = mock(async () => ({ organization_id: 1 }));

    expect(
      await resolveHtmlWebhookOrganizationId({
        form: { organization_id: "2" },
        user: { id: 9, role: "admin" },
        currentForUser,
      }),
    ).toBe(2);
    expect(currentForUser).not.toHaveBeenCalled();
  });

  test("treats an empty form organization id as tenant-wide", async () => {
    const currentForUser = mock(async () => ({ organization_id: 1 }));

    expect(
      await resolveHtmlWebhookOrganizationId({
        form: { organization_id: "" },
        user: { id: 9, role: "admin" },
        currentForUser,
      }),
    ).toBeUndefined();
    expect(currentForUser).not.toHaveBeenCalled();
  });

  test("defaults a missing form field to the current team", async () => {
    expect(
      await resolveHtmlWebhookOrganizationId({
        form: { url: "https://hooks.example.com" },
        user: { id: 4, role: "admin" },
        currentForUser: async (userId) => {
          expect(userId).toBe(4);

          return { organization_id: 7 };
        },
      }),
    ).toBe(7);
  });

  test("defaults when the form is omitted", async () => {
    expect(
      await resolveHtmlWebhookOrganizationId({
        user: { id: 3, role: "admin" },
        currentForUser: async () => ({ organization_id: 1 }),
      }),
    ).toBe(1);
  });

  test("stays tenant-wide when the user has no current organization", async () => {
    expect(
      await resolveHtmlWebhookOrganizationId({
        user: { id: 3, role: "admin" },
        currentForUser: async () => ({ organization_id: null }),
      }),
    ).toBeUndefined();
  });

  test("rejects an invalid form organization id", async () => {
    await expect(
      resolveHtmlWebhookOrganizationId({
        form: { organization_id: "nope" },
        user: { id: 1, role: "admin" },
        currentForUser: async () => ({ organization_id: 1 }),
      }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });
});
