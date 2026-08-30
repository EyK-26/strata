import { describe, expect, test } from "bun:test";
import { ConfigStore, ServiceContainer } from "@getstrata/bootstrap/contracts";
import { hashPassword } from "@getstrata/core/auth/password";
import { repositoryConnection as db } from "@getstrata/core/database/repositoryConnection";
import { NotFoundError, ValidationError } from "@getstrata/core/errors/http";
import { setActiveApplicationContext } from "@getstrata/core/runtime/applicationRegistry";
import { runWithTenantDatabase } from "@getstrata/core/tenant/tenantDatabaseScope";
import OrganizationInvitationRepository from "../../src/modules/organization/invitationRepository";
import {
  OrganizationInvitationService,
  organizationInvitationServiceToken,
  parseInvitationRole,
  resolveInvitationService,
  resolveInvitationTtlSeconds,
  toInvitationResource,
} from "../../src/modules/organization/invitationService";
import OrganizationRepository from "../../src/modules/organization/repository";
import UserRepository from "../../src/modules/user/repository";
import { restoreEnvVar } from "../helpers/restoreEnv";
import { createMockDependencies, defaultTestTenant } from "./testHelpers";

function service(): OrganizationInvitationService {
  return new OrganizationInvitationService(
    new OrganizationInvitationRepository(),
    new UserRepository(),
    new OrganizationRepository(),
  );
}

describe("OrganizationInvitationService", () => {
  test("invite sends a pending invitation and accept joins the organization", async () => {
    await runWithTenantDatabase(defaultTestTenant, async () => {
      const invitations = service();
      const users = new UserRepository();
      const email = `invite-${Date.now()}@workhub.test`;
      const user = await users.create({
        name: "Invitee",
        email,
        role: "member",
        tenant_id: defaultTestTenant.id,
        password_hash: await hashPassword("password"),
        created_at: new Date(),
        updated_at: new Date(),
      });
      const created = await invitations.invite({
        organizationId: 1,
        email,
        role: "admin",
        invitedByUserId: 1,
      });

      expect(created.invitation.email).toBe(email);
      expect(created.invitation.role).toBe("admin");
      expect(created.token).toMatch(/^[a-f0-9]{64}$/);
      expect(created.acceptUrl).toContain("/invitations/accept");
      expect(await invitations.listPending(1)).toEqual(
        expect.arrayContaining([expect.objectContaining({ email, role: "admin" })]),
      );

      const member = await invitations.accept(email, created.token, user);
      expect(member.organization_id).toBe(1);
      expect(member.user_id).toBe(user.id);
      expect(member.role).toBe("admin");
      expect((await users.findByIdOrThrow(user.id)).current_organization_id).toBe(1);
      expect((await invitations.listPending(1)).some((row) => row.email === email)).toBe(false);
    });
  });

  test("invite rejects members that already belong to the organization", async () => {
    await runWithTenantDatabase(defaultTestTenant, async () => {
      await expect(
        service().invite({
          organizationId: 1,
          email: "admin@workhub.test",
          invitedByUserId: 1,
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  test("invite rejects a missing organization and an invalid email", async () => {
    await runWithTenantDatabase(defaultTestTenant, async () => {
      const invitations = service();

      await expect(
        invitations.invite({
          organizationId: 999_999,
          email: "missing-org@workhub.test",
          invitedByUserId: 1,
        }),
      ).rejects.toBeInstanceOf(NotFoundError);

      await expect(
        invitations.invite({
          organizationId: 1,
          email: "not-an-email",
          invitedByUserId: 1,
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  test("re-invite replaces the previous token and cancel removes it", async () => {
    await runWithTenantDatabase(defaultTestTenant, async () => {
      const invitations = service();
      const email = `reinvite-${Date.now()}@workhub.test`;
      const first = await invitations.invite({
        organizationId: 1,
        email,
        invitedByUserId: 1,
      });
      const second = await invitations.invite({
        organizationId: 1,
        email,
        role: "member",
        invitedByUserId: 1,
      });

      expect(second.invitation.id).not.toBe(first.invitation.id);
      await invitations.cancel(1, second.invitation.id);
      expect((await invitations.listPending(1)).some((row) => row.email === email)).toBe(false);
      await expect(invitations.cancel(1, second.invitation.id)).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });
  });

  test("accept rejects a mismatched email, bad token, and expired invitation", async () => {
    await runWithTenantDatabase(defaultTestTenant, async () => {
      const invitations = service();
      const users = new UserRepository();
      const email = `expire-${Date.now()}@workhub.test`;
      const user = await users.create({
        name: "Expire Invitee",
        email,
        role: "member",
        tenant_id: defaultTestTenant.id,
        password_hash: await hashPassword("password"),
        created_at: new Date(),
        updated_at: new Date(),
      });
      const created = await invitations.invite({
        organizationId: 1,
        email,
        invitedByUserId: 1,
      });

      await expect(
        invitations.accept(email, created.token, { id: user.id, email: "other@workhub.test" }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(invitations.accept(email, "deadbeef", user)).rejects.toBeInstanceOf(
        ValidationError,
      );

      await db`
        UPDATE organization_invitation
        SET expires_at = ${new Date(Date.now() - 1000)}
        WHERE email = ${email}
      `;

      await expect(invitations.accept(email, created.token, user)).rejects.toBeInstanceOf(
        ValidationError,
      );
    });
  });

  test("accept is idempotent when the user is already a member", async () => {
    await runWithTenantDatabase(defaultTestTenant, async () => {
      const invitations = service();
      const users = new UserRepository();
      const email = `already-${Date.now()}@workhub.test`;
      const user = await users.create({
        name: "Already Member",
        email,
        role: "member",
        tenant_id: defaultTestTenant.id,
        password_hash: await hashPassword("password"),
        created_at: new Date(),
        updated_at: new Date(),
      });
      const created = await invitations.invite({
        organizationId: 1,
        email,
        invitedByUserId: 1,
      });
      const first = await invitations.accept(email, created.token, user);
      const leftover = await invitations.invite({
        organizationId: 1,
        email: `second-${email}`,
        invitedByUserId: 1,
      });
      await db`
        UPDATE organization_invitation
        SET email = ${email}
        WHERE id = ${leftover.invitation.id}
      `;

      const again = await invitations.accept(email, leftover.token, user);
      expect(again.user_id).toBe(first.user_id);
      expect(again.organization_id).toBe(1);
      expect((await users.findByIdOrThrow(user.id)).current_organization_id).toBe(1);
    });
  });

  test("acceptPendingForUser joins remaining invites and skips expired rows", async () => {
    await runWithTenantDatabase(defaultTestTenant, async () => {
      const invitations = service();
      const users = new UserRepository();
      const email = `pending-${Date.now()}@workhub.test`;
      const user = await users.create({
        name: "Pending Invitee",
        email,
        role: "member",
        tenant_id: defaultTestTenant.id,
        password_hash: await hashPassword("password"),
        created_at: new Date(),
        updated_at: new Date(),
      });
      await invitations.invite({
        organizationId: 1,
        email,
        invitedByUserId: 1,
      });
      await db`
        UPDATE organization_invitation
        SET expires_at = ${new Date(Date.now() - 1000)}
        WHERE email = ${email}
      `;
      expect(await invitations.acceptPendingForUser(user)).toBe(0);
      expect((await users.findByIdOrThrow(user.id)).current_organization_id).toBeNull();

      await invitations.invite({
        organizationId: 1,
        email,
        invitedByUserId: 1,
      });
      expect(await invitations.acceptPendingForUser(user)).toBe(1);
      expect((await users.findByIdOrThrow(user.id)).current_organization_id).toBe(1);
      expect(await invitations.acceptPendingForUser(user)).toBe(0);
    });
  });

  test("helper utilities cover role, TTL, resources, and service resolution", () => {
    expect(parseInvitationRole(undefined)).toBe("member");
    expect(parseInvitationRole("owner")).toBe("owner");
    expect(() => parseInvitationRole("superadmin")).toThrow(ValidationError);

    const previousTtl = process.env.ORGANIZATION_INVITATION_TTL_SECONDS;
    process.env.ORGANIZATION_INVITATION_TTL_SECONDS = "120";
    expect(resolveInvitationTtlSeconds()).toBe(120);
    process.env.ORGANIZATION_INVITATION_TTL_SECONDS = "nope";
    expect(resolveInvitationTtlSeconds()).toBe(60 * 60 * 24 * 7);
    restoreEnvVar("ORGANIZATION_INVITATION_TTL_SECONDS", previousTtl);

    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    expect(
      toInvitationResource({
        id: 8,
        organization_id: 1,
        email: "a@workhub.test",
        role: "member",
        invited_by: 1,
        token_hash: "hash",
        expires_at: createdAt,
        created_at: createdAt,
      }),
    ).toEqual({
      id: 8,
      organization_id: 1,
      email: "a@workhub.test",
      role: "member",
      invited_by: 1,
      expires_at: createdAt.toISOString(),
      created_at: createdAt.toISOString(),
    });

    const container = new ServiceContainer();
    container.has = () => {
      throw new Error("boom");
    };
    setActiveApplicationContext({
      container,
      config: new ConfigStore(),
      dependencies: createMockDependencies(container),
    });
    expect(resolveInvitationService()).toBeInstanceOf(OrganizationInvitationService);

    const bound = service();
    const boundContainer = new ServiceContainer();
    boundContainer.set(organizationInvitationServiceToken, bound);
    setActiveApplicationContext({
      container: boundContainer,
      config: new ConfigStore(),
      dependencies: createMockDependencies(boundContainer),
    });
    expect(resolveInvitationService()).toBe(bound);
  });
});
