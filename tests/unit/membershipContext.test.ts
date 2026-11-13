import { describe, expect, test } from "bun:test";
import { currentAuthUser, runWithAuthUser } from "@getstrata/core/auth/authContext";
import {
  currentOrganizationIds,
  currentOrgRole,
  hasMinimumOrgRole,
  hasOrgMembership,
  runWithMembershipContext,
} from "@getstrata/core/auth/membershipContext";

import { createMembershipMiddleware } from "@getstrata/core/auth/membershipMiddleware";
import { bounded, deferred } from "../fixtures/applicationOwnershipSupport";

describe("membershipContext", () => {
  test("loads memberships for members and skips lookup for admins", async () => {
    const lookup = {
      listForUser: async () => [
        { id: 1, organization_id: 5, user_id: 2, role: "admin" as const, created_at: new Date() },
        { id: 2, organization_id: 6, user_id: 2, role: "member" as const, created_at: new Date() },
      ],
      findMembership: async () => null,
      listForOrganization: async () => [],
      addMember: async () => {
        throw new Error("unused");
      },
      removeMember: async () => undefined,
      updateMemberRole: async () => {
        throw new Error("unused");
      },
    };

    await runWithAuthUser({ id: 2, role: "member" }, async () => {
      await runWithMembershipContext(lookup, currentAuthUser(), () => {
        expect(currentOrganizationIds()).toEqual([5, 6]);
        expect(currentOrgRole(5)).toBe("admin");
        expect(hasOrgMembership(6)).toBe(true);
        expect(hasOrgMembership(9)).toBe(false);
        expect(hasMinimumOrgRole(5, "admin")).toBe(true);
        expect(hasMinimumOrgRole(6, "admin")).toBe(false);
        expect(hasMinimumOrgRole(9, "member")).toBe(false);
      });
    });

    await runWithAuthUser({ id: 1, role: "admin" }, async () => {
      await runWithMembershipContext(lookup, currentAuthUser(), () => {
        expect(currentOrganizationIds()).toEqual([]);
      });
    });
  });
});

test("exported membership middleware restores nested snapshots and isolates overlapping requests", async () => {
  const request = new Request("http://example.test/memberships");
  const outer = createMembershipMiddleware(
    Object.freeze([{ organization_id: 11, role: "owner" as const }]),
  );
  const inner = createMembershipMiddleware(
    Object.freeze([{ organization_id: 22, role: "admin" as const }]),
  );
  const competing = createMembershipMiddleware(
    Object.freeze([{ organization_id: 33, role: "member" as const }]),
  );
  const innerEntered = deferred();
  const competingEntered = deferred();
  const outerRestored = deferred();
  const failure = new Error("nested membership handler failed");
  const first = outer(request, async () => {
    expect(currentOrganizationIds()).toEqual([11]);
    expect(currentOrgRole(11)).toBe("owner");
    const nested = await inner(request, async () => {
      expect(currentOrganizationIds()).toEqual([22]);
      expect(currentOrgRole(11)).toBeNull();
      innerEntered.resolve();
      await bounded(competingEntered.promise);
      expect(currentOrganizationIds()).toEqual([22]);
      expect(currentOrgRole(33)).toBeNull();
      return new Response("nested");
    });
    expect(await nested.text()).toBe("nested");
    expect(currentOrganizationIds()).toEqual([11]);
    await expect(
      inner(request, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(currentOrganizationIds()).toEqual([11]);
    outerRestored.resolve();
    return new Response("outer");
  });
  const second = competing(request, async () => {
    await bounded(innerEntered.promise);
    expect(currentOrganizationIds()).toEqual([33]);
    expect(hasMinimumOrgRole(33, "admin")).toBe(false);
    competingEntered.resolve();
    await bounded(outerRestored.promise);
    expect(currentOrganizationIds()).toEqual([33]);
    expect(currentOrgRole(22)).toBeNull();
    return new Response("competing");
  });
  const responses = await bounded(Promise.all([first, second]));
  expect(await Promise.all(responses.map((response) => response.text()))).toEqual([
    "outer",
    "competing",
  ]);
  expect(currentOrganizationIds()).toEqual([]);
  expect(currentOrgRole(11)).toBeNull();
});
