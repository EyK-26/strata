import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { ConfigStore, ServiceContainer } from "@getstrata/bootstrap/contracts";
import type MembershipService from "@getstrata/core/auth/membershipService";
import { setActiveApplicationContext } from "@getstrata/core/runtime/applicationRegistry";
import type OrganizationRepository from "../../src/modules/organization/repository";
import OrganizationService, {
  personalOrganizationName,
  personalOrganizationSlug,
} from "../../src/modules/organization/service";
import type { OrganizationRecord } from "../../src/modules/organization/types";
import { createMockCache, createMockDependencies } from "./testHelpers";

const now = new Date("2026-01-01T00:00:00.000Z");

const existingOrganization: OrganizationRecord = {
  id: 7,
  tenant_id: 1,
  name: "Ada Lovelace's workspace",
  slug: "personal-9",
  created_at: now,
  updated_at: now,
  deleted_at: null,
};

function createRepository(
  overrides: Partial<Pick<OrganizationRepository, "findBySlug" | "create">> = {},
): Pick<OrganizationRepository, "findBySlug" | "create"> {
  return {
    findBySlug: mock(async () => null),
    create: mock(async (input: Omit<OrganizationRecord, "id" | "deleted_at">) => ({
      id: 42,
      deleted_at: null,
      ...input,
    })),
    ...overrides,
  };
}

function createService(
  repository: Pick<OrganizationRepository, "findBySlug" | "create">,
  memberships: MembershipService,
): OrganizationService {
  const container = new ServiceContainer();
  container.set("core.membership", memberships);
  setActiveApplicationContext({
    container,
    config: new ConfigStore(),
    dependencies: createMockDependencies(container, createMockCache()),
  });

  return new OrganizationService(repository as OrganizationRepository);
}

describe("OrganizationService.createPersonalForUser", () => {
  beforeEach(() => {
    mock.restore();
  });

  afterEach(() => {
    mock.restore();
  });

  test("personalOrganizationName and slug helpers format Jetstream-style workspaces", () => {
    expect(personalOrganizationName("Ada Lovelace")).toBe("Ada Lovelace's workspace");
    expect(personalOrganizationName("  ")).toBe("Personal workspace");
    expect(personalOrganizationName(null)).toBe("Personal workspace");
    expect(personalOrganizationName(undefined)).toBe("Personal workspace");
    expect(personalOrganizationSlug(9)).toBe("personal-9");
  });

  test("creates a personal workspace and adds the user as owner without currentAuthUser", async () => {
    const repository = createRepository();
    const addOwnerOnOrganizationCreate = mock(async () => undefined);
    const memberships = {
      getOrgRole: mock(async () => null),
      addOwnerOnOrganizationCreate,
    } as unknown as MembershipService;
    const service = createService(repository, memberships);

    const organization = await service.createPersonalForUser({ id: 9, name: "Ada Lovelace" });

    expect(organization).toMatchObject({
      id: 42,
      name: "Ada Lovelace's workspace",
      slug: "personal-9",
      tenant_id: 1,
    });
    expect(repository.create).toHaveBeenCalled();
    expect(addOwnerOnOrganizationCreate).toHaveBeenCalledWith(42, 9);
  });

  test("uses a fallback name when the user name is blank", async () => {
    const repository = createRepository();
    const service = createService(repository, {
      getOrgRole: mock(async () => null),
      addOwnerOnOrganizationCreate: mock(async () => undefined),
    } as unknown as MembershipService);

    const organization = await service.createPersonalForUser({ id: 3, name: "" });

    expect(organization.name).toBe("Personal workspace");
    expect(organization.slug).toBe("personal-3");
  });

  test("returns the existing personal workspace and skips addOwner when already a member", async () => {
    const addOwnerOnOrganizationCreate = mock(async () => undefined);
    const repository = createRepository({
      findBySlug: mock(async () => existingOrganization),
    });
    const service = createService(repository, {
      getOrgRole: mock(async () => "owner"),
      addOwnerOnOrganizationCreate,
    } as unknown as MembershipService);

    await expect(service.createPersonalForUser({ id: 9, name: "Ada Lovelace" })).resolves.toEqual(
      existingOrganization,
    );
    expect(repository.create).not.toHaveBeenCalled();
    expect(addOwnerOnOrganizationCreate).not.toHaveBeenCalled();
  });

  test("reattaches owner membership when the personal workspace already exists", async () => {
    const addOwnerOnOrganizationCreate = mock(async () => undefined);
    const repository = createRepository({
      findBySlug: mock(async () => existingOrganization),
    });
    const service = createService(repository, {
      getOrgRole: mock(async () => null),
      addOwnerOnOrganizationCreate,
    } as unknown as MembershipService);

    await expect(service.createPersonalForUser({ id: 9, name: "Ada Lovelace" })).resolves.toEqual(
      existingOrganization,
    );
    expect(addOwnerOnOrganizationCreate).toHaveBeenCalledWith(7, 9);
  });

  test("rejects invalid user ids", async () => {
    const service = createService(createRepository(), {
      getOrgRole: mock(async () => null),
      addOwnerOnOrganizationCreate: mock(async () => undefined),
    } as unknown as MembershipService);

    await expect(service.createPersonalForUser({ id: 0, name: "Ada" })).rejects.toThrow(
      "Invalid user id for personal organization.",
    );
  });
});
