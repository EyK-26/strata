import { describe, expect, mock, test } from "bun:test";
import { ForbiddenError } from "@getstrata/core/errors/http";
import {
  htmlProjectListQuerySuffix,
  resolveHtmlProjectListOrganizationId,
} from "../../src/modules/project/listScope";

describe("resolveHtmlProjectListOrganizationId", () => {
  test("keeps an explicit query organization id", async () => {
    const currentForUser = mock(async () => ({ organization_id: 1 }));

    expect(
      await resolveHtmlProjectListOrganizationId({
        queryOrganizationId: 2,
        user: { id: 9, role: "member" },
        currentForUser,
      }),
    ).toBe(2);
    expect(currentForUser).not.toHaveBeenCalled();
  });

  test("leaves guests unscoped", async () => {
    const currentForUser = mock(async () => ({ organization_id: 1 }));

    expect(
      await resolveHtmlProjectListOrganizationId({
        user: null,
        currentForUser,
      }),
    ).toBeUndefined();
    expect(currentForUser).not.toHaveBeenCalled();
  });

  test("uses the signed-in current organization", async () => {
    expect(
      await resolveHtmlProjectListOrganizationId({
        user: { id: "4", role: "member" },
        currentForUser: async (userId) => {
          expect(userId).toBe(4);

          return { organization_id: 7 };
        },
      }),
    ).toBe(7);
  });

  test("stays unscoped when the user has no current organization", async () => {
    expect(
      await resolveHtmlProjectListOrganizationId({
        user: { id: 3, role: "admin" },
        currentForUser: async () => ({ organization_id: null }),
      }),
    ).toBeUndefined();
  });

  test("rejects an invalid authenticated user id", async () => {
    await expect(
      resolveHtmlProjectListOrganizationId({
        user: { id: "not-a-user", role: "member" },
        currentForUser: async () => ({ organization_id: 1 }),
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("htmlProjectListQuerySuffix", () => {
  test("returns an empty suffix when nothing is filtered", () => {
    expect(htmlProjectListQuerySuffix({})).toBe("");
    expect(htmlProjectListQuerySuffix({ status: "" })).toBe("");
  });

  test("encodes organization and status filters", () => {
    expect(htmlProjectListQuerySuffix({ organizationId: 2 })).toBe("&organizationId=2");
    expect(htmlProjectListQuerySuffix({ status: "active" })).toBe("&status=active");
    expect(htmlProjectListQuerySuffix({ organizationId: 1, status: "draft" })).toBe(
      "&organizationId=1&status=draft",
    );
  });
});
