import { afterEach, describe, expect, test } from "bun:test";
import { resetDatabaseConnectionForTests } from "../../src/db/connection";
import OrganizationInvitationRepository from "../../src/modules/organization/invitationRepository";
import { createMockDatabaseConnection, restoreDefaultDatabaseConnection } from "./testHelpers";

const now = new Date("2026-01-01T00:00:00.000Z");
const invitation = {
  id: 4,
  organization_id: 5,
  email: "invitee@workhub.test",
  role: "member" as const,
  invited_by: 1,
  token_hash: "hash",
  expires_at: now,
  created_at: now,
};

describe("OrganizationInvitationRepository", () => {
  afterEach(async () => {
    await restoreDefaultDatabaseConnection();
  });

  test("create persists an invitation row", async () => {
    const mockConnection = createMockDatabaseConnection(async (strings) => {
      expect(strings.join("")).toContain("INSERT INTO organization_invitation");
      return [invitation];
    });

    resetDatabaseConnectionForTests(mockConnection as never);
    const repository = new OrganizationInvitationRepository();

    await expect(
      repository.create({
        organizationId: 5,
        email: "invitee@workhub.test",
        role: "member",
        invitedBy: 1,
        tokenHash: "hash",
        expiresAt: now,
      }),
    ).resolves.toEqual(invitation);
  });

  test("create throws when insert does not return a row", async () => {
    resetDatabaseConnectionForTests(createMockDatabaseConnection(async () => []) as never);
    const repository = new OrganizationInvitationRepository();

    await expect(
      repository.create({
        organizationId: 5,
        email: "invitee@workhub.test",
        role: "member",
        invitedBy: 1,
        tokenHash: "hash",
        expiresAt: now,
      }),
    ).rejects.toThrow("Organization invitation insert did not return a row.");
  });

  test("findById returns a row or null", async () => {
    resetDatabaseConnectionForTests(
      createMockDatabaseConnection(async () => [invitation]) as never,
    );
    await expect(new OrganizationInvitationRepository().findById(4)).resolves.toEqual(invitation);

    resetDatabaseConnectionForTests(createMockDatabaseConnection(async () => []) as never);
    await expect(new OrganizationInvitationRepository().findById(4)).resolves.toBeNull();
  });

  test("findPendingByOrganizationAndEmail returns a row or null", async () => {
    resetDatabaseConnectionForTests(
      createMockDatabaseConnection(async (strings) => {
        expect(strings.join("")).toContain("organization_id");
        return [invitation];
      }) as never,
    );
    await expect(
      new OrganizationInvitationRepository().findPendingByOrganizationAndEmail(
        5,
        "invitee@workhub.test",
      ),
    ).resolves.toEqual(invitation);

    resetDatabaseConnectionForTests(createMockDatabaseConnection(async () => []) as never);
    await expect(
      new OrganizationInvitationRepository().findPendingByOrganizationAndEmail(
        5,
        "invitee@workhub.test",
      ),
    ).resolves.toBeNull();
  });

  test("list helpers return matching rows", async () => {
    resetDatabaseConnectionForTests(
      createMockDatabaseConnection(async () => [invitation]) as never,
    );
    const repository = new OrganizationInvitationRepository();

    await expect(repository.listPendingForOrganization(5)).resolves.toEqual([invitation]);
    await expect(repository.listPendingByEmail("invitee@workhub.test")).resolves.toEqual([
      invitation,
    ]);
  });

  test("delete helpers return whether a row was removed", async () => {
    resetDatabaseConnectionForTests(createMockDatabaseConnection(async () => [{ id: 4 }]) as never);
    const repository = new OrganizationInvitationRepository();

    await expect(repository.deleteById(4)).resolves.toBe(true);
    await expect(repository.deleteByOrganizationAndEmail(5, "invitee@workhub.test")).resolves.toBe(
      true,
    );
    await expect(repository.deleteByIdAndOrganization(5, 4)).resolves.toBe(true);

    resetDatabaseConnectionForTests(createMockDatabaseConnection(async () => []) as never);
    const empty = new OrganizationInvitationRepository();
    await expect(empty.deleteById(4)).resolves.toBe(false);
    await expect(empty.deleteByOrganizationAndEmail(5, "invitee@workhub.test")).resolves.toBe(
      false,
    );
    await expect(empty.deleteByIdAndOrganization(5, 4)).resolves.toBe(false);
  });

  test("findByIdAndOrganizationOrThrow returns or throws", async () => {
    resetDatabaseConnectionForTests(
      createMockDatabaseConnection(async () => [invitation]) as never,
    );
    await expect(
      new OrganizationInvitationRepository().findByIdAndOrganizationOrThrow(5, 4),
    ).resolves.toEqual(invitation);

    resetDatabaseConnectionForTests(createMockDatabaseConnection(async () => []) as never);
    await expect(
      new OrganizationInvitationRepository().findByIdAndOrganizationOrThrow(5, 4),
    ).rejects.toThrow("Organization invitation 4 not found.");
  });

  test("refreshToken updates the token hash or throws", async () => {
    const refreshed = { ...invitation, token_hash: "next" };
    resetDatabaseConnectionForTests(
      createMockDatabaseConnection(async (strings) => {
        expect(strings.join("")).toContain("UPDATE organization_invitation");
        return [refreshed];
      }) as never,
    );
    await expect(
      new OrganizationInvitationRepository().refreshToken(4, "next", now),
    ).resolves.toEqual(refreshed);

    resetDatabaseConnectionForTests(createMockDatabaseConnection(async () => []) as never);
    await expect(
      new OrganizationInvitationRepository().refreshToken(4, "next", now),
    ).rejects.toThrow("Organization invitation refresh did not return a row.");
  });
});
