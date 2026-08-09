import { describe, expect, test } from "bun:test";
import { runWithAuthUser } from "../../src/core/auth/authContext";
import { membershipContext } from "../../src/core/auth/membershipContext";
import {
  appendOrganizationScope,
  appendProjectScope,
  assertOrganizationReadable,
  assertResourceInCurrentTenant,
  emptyPaginateResult,
  resolveOrganizationScope,
  scopedOrganizationIds,
} from "../../src/core/auth/membershipScope";
import { NotFoundError } from "../../src/core/errors/http";
import { runWithTenant } from "../../src/core/tenant/tenantContext";

function withMembership(
  user: { id: number; role?: string } | null,
  organizationIds: number[],
  callback: () => void,
): void {
  runWithAuthUser(user, () => {
    membershipContext.run(
      {
        organizationIds,
        rolesByOrganizationId: new Map(organizationIds.map((id) => [id, "member" as const])),
      },
      callback,
    );
  });
}

describe("membershipScope", () => {
  test("resolveOrganizationScope returns null for guests and global admins", () => {
    expect(resolveOrganizationScope()).toBe(null);

    runWithAuthUser({ id: 1, role: "admin" }, () => {
      expect(resolveOrganizationScope()).toBe(null);
    });
  });

  test("resolveOrganizationScope returns current organization ids for members", () => {
    withMembership({ id: 2, role: "member" }, [3, 4], () => {
      expect(resolveOrganizationScope()).toEqual([3, 4]);
    });
  });

  test("scopedOrganizationIds handles unrestricted and filtered organization access", () => {
    expect(scopedOrganizationIds()).toBe(null);
    expect(scopedOrganizationIds(7)).toEqual([7]);

    withMembership({ id: 2, role: "member" }, [3, 4], () => {
      expect(scopedOrganizationIds()).toEqual([3, 4]);
      expect(scopedOrganizationIds(3)).toEqual([3]);
      expect(scopedOrganizationIds(99)).toEqual([]);
    });
  });

  test("appendOrganizationScope leaves queries unchanged for unrestricted users", () => {
    expect(appendOrganizationScope({ status: "active" })).toEqual({ status: "active" });
  });

  test("appendOrganizationScope constrains queries to accessible organizations", () => {
    expect(appendOrganizationScope({ status: "active" }, 7)).toMatchObject({
      status: "active",
      organization_id: 7,
    });

    withMembership({ id: 2, role: "member" }, [], () => {
      expect(appendOrganizationScope({ status: "active" })).toMatchObject({
        status: "active",
        organization_id: [-1],
      });
    });

    withMembership({ id: 2, role: "member" }, [5], () => {
      expect(appendOrganizationScope({ status: "active" }, 5)).toMatchObject({
        status: "active",
        organization_id: 5,
      });
      expect(appendOrganizationScope({ status: "active" })).toMatchObject({
        status: "active",
        organization_id: 5,
      });
    });

    withMembership({ id: 2, role: "member" }, [5, 6], () => {
      expect(appendOrganizationScope({ status: "active" })).toMatchObject({
        status: "active",
        organization_id: [5, 6],
      });
    });
  });

  test("appendProjectScope handles unrestricted, empty, and filtered project access", () => {
    expect(appendProjectScope({}, null)).toEqual({});
    expect(appendProjectScope({ status: "todo" }, null, 9)).toMatchObject({
      status: "todo",
      project_id: 9,
    });

    expect(appendProjectScope({}, [])).toEqual({ project_id: [-1] });
    expect(appendProjectScope({}, [1, 2], 2)).toEqual({ project_id: 2 });
    expect(appendProjectScope({}, [1, 2], 9)).toEqual({ project_id: -1 });
    expect(appendProjectScope({}, [1, 2])).toEqual({ project_id: [1, 2] });
  });

  test("emptyPaginateResult returns an empty page with stable metadata", () => {
    expect(emptyPaginateResult(2, 25)).toEqual({
      data: [],
      meta: {
        page: 2,
        per_page: 25,
        total: 0,
        last_page: 1,
      },
    });
  });

  test("assertResourceInCurrentTenant rejects resources outside the active tenant", () => {
    runWithTenant({ id: 3, slug: "acme", plan: "free", region: "eu" }, () => {
      expect(() => assertResourceInCurrentTenant(3, "Task", 12)).not.toThrow();
      expect(() => assertResourceInCurrentTenant(4, "Task", 12)).toThrow(NotFoundError);
    });
  });

  test("assertOrganizationReadable allows global admins and rejects inaccessible organizations", () => {
    runWithAuthUser({ id: 1, role: "admin" }, () => {
      expect(() => assertOrganizationReadable(99)).not.toThrow();
    });

    withMembership({ id: 2, role: "member" }, [8], () => {
      expect(() => assertOrganizationReadable(8)).not.toThrow();
      expect(() => assertOrganizationReadable(99)).toThrow(NotFoundError);
    });
  });

  test("assertOrganizationReadable allows guests to read without membership checks", () => {
    expect(() => assertOrganizationReadable(99)).not.toThrow();
  });
});
