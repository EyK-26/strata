import { beforeEach, describe, expect, test } from "bun:test";
import { ConfigStore, ServiceContainer } from "@getstrata/bootstrap/contracts";
import { runWithAuthUser } from "@getstrata/core/auth/authContext";
import MembershipService from "@getstrata/core/auth/membershipService";
import { ForbiddenError, NotFoundError } from "@getstrata/core/errors/http";
import { setActiveApplicationContext } from "@getstrata/core/runtime/applicationRegistry";
import { runWithTenantDatabase } from "@getstrata/core/tenant/tenantDatabaseScope";
import OrganizationMemberRepository from "../../src/modules/organization/memberRepository";
import OrganizationRepository from "../../src/modules/organization/repository";
import {
  CurrentOrganizationService,
  toCurrentOrganizationResource,
} from "../../src/modules/user/currentOrganizationService";
import UserRepository from "../../src/modules/user/repository";
import { createMockCache, createMockDependencies, defaultTestTenant } from "./testHelpers";

function useRealMembershipService(): void {
  const container = new ServiceContainer();
  container.set("core.membership", new MembershipService());
  setActiveApplicationContext({
    container,
    config: new ConfigStore(),
    dependencies: createMockDependencies(container, createMockCache()),
  });
}

function service(): CurrentOrganizationService {
  return new CurrentOrganizationService(new UserRepository(), new OrganizationRepository());
}

describe("CurrentOrganizationService", () => {
  beforeEach(() => {
    useRealMembershipService();
  });

  test("assignIfMissing sets current organization once", async () => {
    await runWithTenantDatabase(defaultTestTenant, async () => {
      const users = new UserRepository();
      const current = service();
      const created = await users.create({
        name: "Current Org User",
        email: `current-org-${Date.now()}@workhub.test`,
        role: "member",
        tenant_id: defaultTestTenant.id,
        created_at: new Date(),
        updated_at: new Date(),
      });

      await current.assignIfMissing(created.id, 1);
      expect((await users.findByIdOrThrow(created.id)).current_organization_id).toBe(1);

      await current.assignIfMissing(created.id, 2);
      expect((await users.findByIdOrThrow(created.id)).current_organization_id).toBe(1);
    });
  });

  test("currentForUser returns the organization resource or a missing id", async () => {
    await runWithTenantDatabase(defaultTestTenant, async () => {
      const users = new UserRepository();
      const current = service();
      const created = await users.create({
        name: "Current Org Reader",
        email: `current-org-read-${Date.now()}@workhub.test`,
        role: "member",
        tenant_id: defaultTestTenant.id,
        created_at: new Date(),
        updated_at: new Date(),
      });

      expect(await current.currentForUser(created.id)).toEqual({
        organization_id: null,
        organization: null,
      });

      await current.assign(created.id, 1);
      expect(await current.currentForUser(created.id)).toEqual({
        organization_id: 1,
        organization: { id: 1, name: "Acme Labs", slug: "acme-labs" },
      });

      const missing = new CurrentOrganizationService(users, {
        findById: async () => null,
      } as unknown as OrganizationRepository);
      await users.updateByIdOrThrow(created.id, { current_organization_id: 1 });
      expect(await missing.currentForUser(created.id)).toEqual({
        organization_id: 1,
        organization: null,
      });
      expect(await missing.resolveHomePath(created.id, "/organizations")).toBe("/organizations");
    });
  });

  test("switchForUser requires membership and rejects a missing organization", async () => {
    await runWithTenantDatabase(defaultTestTenant, async () => {
      const current = service();

      await expect(
        runWithAuthUser({ id: 2, role: "member" }, () => current.switchForUser(2, 999_999)),
      ).rejects.toBeInstanceOf(NotFoundError);

      await expect(
        runWithAuthUser({ id: 2, role: "member" }, () => current.switchForUser(2, 2)),
      ).rejects.toBeInstanceOf(ForbiddenError);

      const switched = await runWithAuthUser({ id: 1, role: "admin", abilities: ["*"] }, () =>
        current.switchForUser(1, 2),
      );
      expect(switched).toEqual({
        organization_id: 2,
        organization: { id: 2, name: "Orbital Works", slug: "orbital-works" },
      });
      await current.assign(1, 1);
    });
  });

  test("resolveHomePath uses the current organization for the org list and root", async () => {
    await runWithTenantDatabase(defaultTestTenant, async () => {
      const current = service();
      await current.assign(1, 1);

      expect(await current.resolveHomePath(1, "/account")).toBe("/account");
      expect(await current.resolveHomePath(1, "/organizations")).toBe("/organizations/1");
      expect(await current.resolveHomePath(1, "/")).toBe("/organizations/1");

      const users = new UserRepository();
      const created = await users.create({
        name: "No Current Org",
        email: `no-current-${Date.now()}@workhub.test`,
        role: "member",
        tenant_id: defaultTestTenant.id,
        created_at: new Date(),
        updated_at: new Date(),
      });
      expect(await current.resolveHomePath(created.id)).toBe("/organizations");
    });
  });

  test("clearIfCurrent switches to another membership or clears", async () => {
    await runWithTenantDatabase(defaultTestTenant, async () => {
      const users = new UserRepository();
      const current = service();
      const created = await users.create({
        name: "Clear Current Org",
        email: `clear-current-${Date.now()}@workhub.test`,
        role: "member",
        tenant_id: defaultTestTenant.id,
        created_at: new Date(),
        updated_at: new Date(),
      });

      await current.clearIfCurrent(created.id, 1);
      expect((await users.findByIdOrThrow(created.id)).current_organization_id).toBeNull();

      await current.assign(created.id, 1);
      await current.clearIfCurrent(created.id, 2);
      expect((await users.findByIdOrThrow(created.id)).current_organization_id).toBe(1);

      const members = new OrganizationMemberRepository();
      await members.addMember({ organizationId: 1, userId: created.id, role: "member" });
      await members.addMember({ organizationId: 2, userId: created.id, role: "member" });
      await current.clearIfCurrent(created.id, 1);
      expect((await users.findByIdOrThrow(created.id)).current_organization_id).toBe(2);

      await members.removeMember(1, created.id);
      await members.removeMember(2, created.id);
      await current.clearIfCurrent(created.id, 2);
      expect((await users.findByIdOrThrow(created.id)).current_organization_id).toBeNull();

      await current.clearIfCurrent(999_999, 1);
    });
  });

  test("toCurrentOrganizationResource maps a missing organization", () => {
    expect(toCurrentOrganizationResource(null, 4)).toEqual({
      organization_id: 4,
      organization: null,
    });
  });
});
