import { afterEach, describe, expect, test } from "bun:test";
import { resetDatabaseConnectionForTests } from "../../src/db/connection";
import OrganizationMemberRepository from "../../src/modules/organization/memberRepository";
import { createMockDatabaseConnection, restoreDefaultDatabaseConnection } from "./testHelpers";

const now = new Date("2026-01-01T00:00:00.000Z");

describe("OrganizationMemberRepository", () => {
  afterEach(async () => {
    await restoreDefaultDatabaseConnection();
  });

  test("findMembership returns a membership row when present", async () => {
    const member = {
      id: 1,
      organization_id: 5,
      user_id: 2,
      role: "member" as const,
      created_at: now,
    };

    const mockConnection = createMockDatabaseConnection(async (strings) => {
      const query = strings.join("");

      if (query.includes("FROM organization_member") && query.includes("LIMIT 1")) {
        return [member];
      }

      return [];
    });

    resetDatabaseConnectionForTests(mockConnection as never);
    const repository = new OrganizationMemberRepository();

    await expect(repository.findMembership(2, 5)).resolves.toEqual(member);
  });

  test("findMembership returns null when no membership exists", async () => {
    const mockConnection = createMockDatabaseConnection(async () => []);

    resetDatabaseConnectionForTests(mockConnection as never);
    const repository = new OrganizationMemberRepository();

    await expect(repository.findMembership(2, 5)).resolves.toBeNull();
  });

  test("listForUser returns memberships ordered by organization", async () => {
    const members = [
      {
        id: 1,
        organization_id: 5,
        user_id: 2,
        role: "member" as const,
        created_at: now,
      },
    ];

    const mockConnection = createMockDatabaseConnection(async (strings) => {
      if (strings.join("").includes("WHERE user_id")) {
        return members;
      }

      return [];
    });

    resetDatabaseConnectionForTests(mockConnection as never);
    const repository = new OrganizationMemberRepository();

    await expect(repository.listForUser(2)).resolves.toEqual(members);
  });

  test("listForOrganization returns memberships ordered by id", async () => {
    const members = [
      {
        id: 2,
        organization_id: 5,
        user_id: 3,
        role: "admin" as const,
        created_at: now,
      },
    ];

    const mockConnection = createMockDatabaseConnection(async (strings) => {
      if (strings.join("").includes("WHERE organization_id")) {
        return members;
      }

      return [];
    });

    resetDatabaseConnectionForTests(mockConnection as never);
    const repository = new OrganizationMemberRepository();

    await expect(repository.listForOrganization(5)).resolves.toEqual(members);
  });

  test("addMember inserts members with default and explicit roles", async () => {
    const member = {
      id: 3,
      organization_id: 5,
      user_id: 4,
      role: "member" as const,
      created_at: now,
    };

    const mockConnection = createMockDatabaseConnection(async (strings) => {
      const query = strings.join("");

      if (query.includes("INSERT INTO organization_member")) {
        return [member];
      }

      return [];
    });

    resetDatabaseConnectionForTests(mockConnection as never);
    const repository = new OrganizationMemberRepository();

    await expect(
      repository.addMember({ organizationId: 5, userId: 4, role: "admin" }),
    ).resolves.toEqual(member);
    await expect(repository.addMember({ organizationId: 5, userId: 6 })).resolves.toEqual(member);
  });

  test("addMember throws when insert does not return a row", async () => {
    const mockConnection = createMockDatabaseConnection(async (strings) => {
      if (strings.join("").includes("INSERT INTO organization_member")) {
        return [];
      }

      return [];
    });

    resetDatabaseConnectionForTests(mockConnection as never);
    const repository = new OrganizationMemberRepository();

    await expect(repository.addMember({ organizationId: 5, userId: 4 })).rejects.toThrow(
      "Organization member insert did not return a row.",
    );
  });

  test("updateMemberRole updates the role and returns the row", async () => {
    const member = {
      id: 1,
      organization_id: 5,
      user_id: 2,
      role: "admin" as const,
      created_at: now,
    };

    const mockConnection = createMockDatabaseConnection(async (strings) => {
      if (strings.join("").includes("UPDATE organization_member")) {
        return [member];
      }

      return [];
    });

    resetDatabaseConnectionForTests(mockConnection as never);
    const repository = new OrganizationMemberRepository();

    await expect(repository.updateMemberRole(5, 2, "admin")).resolves.toEqual(member);
  });

  test("updateMemberRole throws when the membership is missing", async () => {
    const mockConnection = createMockDatabaseConnection(async (strings) => {
      if (strings.join("").includes("UPDATE organization_member")) {
        return [];
      }

      return [];
    });

    resetDatabaseConnectionForTests(mockConnection as never);
    const repository = new OrganizationMemberRepository();

    await expect(repository.updateMemberRole(5, 99, "member")).rejects.toThrow(
      "Organization member 99 not found.",
    );
  });

  test("removeMember reports whether a row was deleted", async () => {
    let deleteCalls = 0;

    const mockConnection = createMockDatabaseConnection(async (strings) => {
      if (strings.join("").includes("DELETE FROM organization_member")) {
        deleteCalls += 1;
        return deleteCalls === 1 ? [{ id: 1 }] : [];
      }

      return [];
    });

    resetDatabaseConnectionForTests(mockConnection as never);
    const repository = new OrganizationMemberRepository();

    await expect(repository.removeMember(5, 2)).resolves.toBe(true);
    await expect(repository.removeMember(5, 99)).resolves.toBe(false);
  });
});
