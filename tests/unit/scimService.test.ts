import { describe, expect, test } from "bun:test";
import { NotFoundError } from "../../src/core/errors/http";
import { runWithTenant, type TenantContext } from "../../src/core/tenant/tenantContext";
import { SCIM_SCHEMAS } from "../../src/domain/scim";
import OrganizationMemberRepository from "../../src/modules/organization/memberRepository";
import type {
  OrganizationMemberRecord,
  OrganizationMemberRole,
} from "../../src/modules/organization/memberTypes";
import ScimService from "../../src/modules/scim/service";
import UserRepository from "../../src/modules/user/repository";
import type { UserRecord } from "../../src/modules/user/types";

const now = new Date("2026-01-01T00:00:00.000Z");

const user: UserRecord = {
  id: 1,
  tenant_id: 1,
  name: "Ada Lovelace",
  email: "ada@workhub.test",
  role: "member",
  password_hash: "hash",
  created_at: now,
  updated_at: now,
};

class UserRepositoryMock {
  findAll = async () => [user];
  findById = async (id: number) => (id === user.id ? user : null);
  create = async (values: Partial<UserRecord>) => ({ ...user, ...values, id: 2 });
  updateByIdOrThrow = async (id: number, changes: Partial<UserRecord>) => ({
    ...user,
    id,
    ...changes,
  });
  deleteById = async (id: number) => id === user.id;

  constructor(overrides?: Partial<UserRepositoryMock>) {
    Object.assign(this, overrides);
  }
}

function createMockedService(options?: {
  users?: Partial<UserRepositoryMock>;
  members?: Partial<OrganizationMemberRepositoryMock>;
}) {
  return new ScimService(
    new UserRepositoryMock(options?.users) as unknown as UserRepository,
    new OrganizationMemberRepositoryMock(
      options?.members,
    ) as unknown as OrganizationMemberRepository,
  );
}

class OrganizationMemberRepositoryMock {
  listForOrganization = async (_organizationId: number): Promise<OrganizationMemberRecord[]> => [
    {
      id: 1,
      user_id: 1,
      organization_id: 5,
      role: "member",
      created_at: now,
    },
  ];

  addMember = async (input: {
    organizationId: number;
    userId: number;
    role?: OrganizationMemberRole;
  }): Promise<OrganizationMemberRecord> => ({
    id: 2,
    user_id: input.userId,
    organization_id: input.organizationId,
    role: input.role ?? "member",
    created_at: now,
  });

  constructor(overrides?: Partial<OrganizationMemberRepositoryMock>) {
    Object.assign(this, overrides);
  }
}

const defaultTenant: TenantContext = {
  id: 1,
  slug: "default",
  plan: "free",
  region: "eu",
};

const otherTenant: TenantContext = {
  id: 99,
  slug: "other",
  plan: "free",
  region: "eu",
};

describe("ScimService", () => {
  test("returns service provider config", () => {
    const service = createMockedService();
    const config = service.serviceProviderConfig();

    expect(config.schemas).toContain(SCIM_SCHEMAS.serviceProviderConfig);
    expect(config.patch.supported).toBe(true);
    expect(config.etag.supported).toBe(true);
  });

  test("lists users for the current tenant", async () => {
    const service = new ScimService(new UserRepository(), new OrganizationMemberRepository());

    const response = await runWithTenant(defaultTenant, async () => service.listUsers(1, 100));

    expect(response.schemas).toContain(SCIM_SCHEMAS.listResponse);
    expect(response.totalResults).toBeGreaterThan(0);
  });

  test("gets and finds users within the tenant", async () => {
    const service = createMockedService();

    await runWithTenant(defaultTenant, async () => {
      await expect(service.getUser(1)).resolves.toMatchObject({
        id: "1",
        userName: "ada@workhub.test",
      });
      await expect(service.findUserRecord(1)).resolves.toEqual(user);
    });
  });

  test("findUserRecord rejects missing and cross-tenant users", async () => {
    const service = createMockedService();

    await runWithTenant(defaultTenant, async () => {
      await expect(service.findUserRecord(404)).rejects.toThrow(NotFoundError);
    });

    await runWithTenant(otherTenant, async () => {
      await expect(service.findUserRecord(1)).rejects.toThrow("SCIM user 1 not found.");
    });
  });

  test("creates users from SCIM payloads", async () => {
    const service = createMockedService();

    const created = await runWithTenant(defaultTenant, async () =>
      service.createUser({
        userName: "new.user@workhub.test",
        name: { formatted: "New User" },
      }),
    );

    expect(created.userName).toBe("new.user@workhub.test");
    expect(created.displayName).toBe("New User");
  });

  test("requires userName or email when creating users", async () => {
    const service = createMockedService();

    await expect(runWithTenant(defaultTenant, async () => service.createUser({}))).rejects.toThrow(
      "SCIM userName or email is required.",
    );
  });

  test("creates users from primary email when userName is absent", async () => {
    const service = createMockedService();

    const created = await runWithTenant(defaultTenant, async () =>
      service.createUser({
        emails: [{ value: "primary@workhub.test", primary: true }],
      }),
    );

    expect(created.userName).toBe("primary@workhub.test");
  });

  test("patches user display name and email", async () => {
    const service = createMockedService();

    const patched = await runWithTenant(defaultTenant, async () =>
      service.patchUser(1, [
        { op: "replace", path: "displayName", value: "Updated Name" },
        { op: "replace", path: "userName", value: "updated@workhub.test" },
        { op: "replace", path: "active", value: false },
      ]),
    );

    expect(patched.displayName).toBe("Updated Name");
    expect(patched.userName).toBe("updated@workhub.test");
  });

  test("patches user email using SCIM work email path", async () => {
    const service = createMockedService();

    const patched = await runWithTenant(defaultTenant, async () =>
      service.patchUser(1, [
        { op: "replace", path: 'emails[type eq "work"].value', value: "work@workhub.test" },
      ]),
    );

    expect(patched.userName).toBe("work@workhub.test");
  });

  test("deletes users and reports missing rows", async () => {
    const service = createMockedService();

    await expect(runWithTenant(defaultTenant, async () => service.deleteUser(1))).resolves.toEqual({
      id: 1,
      updated_at: now,
    });

    const missingDelete = createMockedService({
      users: { deleteById: async () => false },
    });

    await expect(
      runWithTenant(defaultTenant, async () => missingDelete.deleteUser(1)),
    ).rejects.toThrow("SCIM user 1 not found.");
  });

  test("lists and gets SCIM groups", async () => {
    const service = new ScimService(new UserRepository(), new OrganizationMemberRepository());

    await runWithTenant(defaultTenant, async () => {
      const list = await service.listGroups(1, 100);
      expect(list.Resources.length).toBeGreaterThan(0);

      const groupId = Number.parseInt(list.Resources[0]?.id ?? "0", 10);
      await expect(service.getGroup(groupId)).resolves.toMatchObject({
        id: String(groupId),
      });

      await expect(service.findOrganizationRecord(404)).rejects.toThrow(
        "SCIM group 404 not found.",
      );
    });
  });

  test("patches group membership from SCIM operations", async () => {
    let addedMember:
      | { organizationId: number; userId: number; role: OrganizationMemberRole }
      | undefined;
    const service = createMockedService({
      members: {
        addMember: async (input) => {
          addedMember = {
            organizationId: input.organizationId,
            userId: input.userId,
            role: input.role ?? "member",
          };
          return {
            id: 3,
            user_id: input.userId,
            organization_id: input.organizationId,
            role: input.role ?? "member",
            created_at: now,
          };
        },
        listForOrganization: async () => [],
      },
    });

    await runWithTenant(defaultTenant, async () => {
      const group = await service.patchGroup(1, [
        { op: "add", path: "members", value: { value: "2" } },
        { op: "replace", path: "displayName", value: "Ignored" },
      ]);

      expect(addedMember).toEqual({ organizationId: 1, userId: 2, role: "member" });
      expect(group.displayName).toBeDefined();
    });
  });

  test("patchGroup accepts array member values and ignores invalid ids", async () => {
    const added: number[] = [];
    const service = createMockedService({
      members: {
        addMember: async ({ userId }) => {
          added.push(userId);
          return {
            id: 4,
            user_id: userId,
            organization_id: 1,
            role: "member",
            created_at: now,
          };
        },
        listForOrganization: async () => [],
      },
    });

    await runWithTenant(defaultTenant, async () => {
      await service.patchGroup(1, [
        { op: "add", path: "members", value: [{ value: "2" }, { value: "invalid" }] },
      ]);
    });

    expect(added).toEqual([2]);
  });
});
