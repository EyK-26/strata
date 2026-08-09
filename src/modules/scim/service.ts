import type { AppDependencies } from "@getstrata/bootstrap/contracts";
import { resolveService } from "@getstrata/bootstrap/contracts";
import { hashPassword } from "@getstrata/core/auth/password";
import { NotFoundError } from "@getstrata/core/errors/http";
import { currentTenantId } from "@getstrata/core/tenant/tenantContext";
import db from "../../db/connection";
import { SCIM_SCHEMAS } from "../../domain/scim";
import OrganizationMemberRepository from "../organization/memberRepository";
import { userRepositoryToken } from "../user/provider";
import type UserRepository from "../user/repository";

interface ScimUserPayload {
  userName?: string;
  name?: { formatted?: string };
  active?: boolean;
  emails?: Array<{ value: string; primary?: boolean }>;
}

interface ScimPatchOperation {
  op: string;
  path?: string;
  value?: unknown;
}

class ScimService {
  constructor(
    private readonly users: UserRepository,
    private readonly members: OrganizationMemberRepository,
  ) {}

  serviceProviderConfig() {
    return {
      schemas: [SCIM_SCHEMAS.serviceProviderConfig],
      patch: { supported: true },
      bulk: { supported: false },
      filter: { supported: false },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: true },
      authenticationSchemes: [
        {
          type: "oauthbearertoken",
          name: "OAuth Bearer Token",
          description: "SCIM bearer token authentication",
        },
      ],
    };
  }

  async listUsers(startIndex = 1, count = 100) {
    const tenantId = currentTenantId();
    const offset = Math.max(startIndex - 1, 0);
    const records = await this.users.findAll({
      limit: count,
      offset,
      where: { tenant_id: tenantId },
    });
    const total = Number(
      (
        (await db`
          SELECT COUNT(*)::int AS count
          FROM users
          WHERE tenant_id = ${tenantId}
        `) as Array<{ count: number }>
      )[0]?.count ?? records.length,
    );

    return {
      schemas: [SCIM_SCHEMAS.listResponse],
      totalResults: total,
      startIndex,
      itemsPerPage: records.length,
      Resources: records.map((user) => this.toScimUser(user)),
    };
  }

  async getUser(id: number) {
    const user = await this.findUserRecord(id);
    return this.toScimUser(user);
  }

  async findUserRecord(id: number) {
    const user = await this.users.findById(id);

    if (!user || user.tenant_id !== currentTenantId()) {
      throw new NotFoundError(`SCIM user ${id} not found.`);
    }

    return user;
  }

  async createUser(payload: ScimUserPayload) {
    const email =
      payload.userName ??
      payload.emails?.find((entry) => entry.primary)?.value ??
      payload.emails?.[0]?.value;

    if (!email) {
      throw new Error("SCIM userName or email is required.");
    }

    const passwordHash = await hashPassword(crypto.randomUUID());
    const user = await this.users.create({
      name: payload.name?.formatted ?? email.split("@")[0] ?? "SCIM User",
      email,
      role: "member",
      tenant_id: currentTenantId(),
      password_hash: passwordHash,
      created_at: new Date(),
      updated_at: new Date(),
    });

    return this.toScimUser(user);
  }

  async patchUser(id: number, operations: ScimPatchOperation[]) {
    const user = await this.findUserRecord(id);

    const changes: {
      name?: string;
      email?: string;
      updated_at: Date;
    } = { updated_at: new Date() };

    for (const operation of operations) {
      if (operation.op.toLowerCase() === "replace" && operation.path === "active") {
        continue;
      }

      if (operation.op.toLowerCase() === "replace" && operation.path === "displayName") {
        changes.name = String(operation.value ?? user.name);
      }

      if (
        operation.op.toLowerCase() === "replace" &&
        (operation.path === "userName" || operation.path === 'emails[type eq "work"].value')
      ) {
        changes.email = String(operation.value ?? user.email);
      }
    }

    const updated = await this.users.updateByIdOrThrow(id, changes);
    return this.toScimUser(updated);
  }

  async deleteUser(id: number): Promise<{ id: number; updated_at: Date }> {
    const user = await this.findUserRecord(id);

    const deleted = await this.users.deleteById(id);

    if (!deleted) {
      throw new NotFoundError(`SCIM user ${id} not found.`);
    }

    return { id: user.id, updated_at: user.updated_at };
  }

  async listGroups(startIndex = 1, count = 100) {
    const tenantId = currentTenantId();
    const offset = Math.max(startIndex - 1, 0);
    const rows = (await db`
      SELECT id, name, slug, updated_at
      FROM organization
      WHERE deleted_at IS NULL AND tenant_id = ${tenantId}
      ORDER BY id
      LIMIT ${count} OFFSET ${offset}
    `) as Array<{ id: number; name: string; slug: string; updated_at: Date }>;
    const total = Number(
      (
        (await db`
          SELECT COUNT(*)::int AS count
          FROM organization
          WHERE deleted_at IS NULL AND tenant_id = ${tenantId}
        `) as Array<{ count: number }>
      )[0]?.count ?? rows.length,
    );

    const resources = await Promise.all(rows.map((row) => this.toScimGroup(row)));

    return {
      schemas: [SCIM_SCHEMAS.listResponse],
      totalResults: total,
      startIndex,
      itemsPerPage: resources.length,
      Resources: resources,
    };
  }

  async getGroup(id: number) {
    const organization = await this.findOrganizationRecord(id);
    return await this.toScimGroup(organization);
  }

  async findOrganizationRecord(id: number) {
    const tenantId = currentTenantId();
    const rows = (await db`
      SELECT id, name, slug, updated_at
      FROM organization
      WHERE id = ${id} AND deleted_at IS NULL AND tenant_id = ${tenantId}
      LIMIT 1
    `) as Array<{ id: number; name: string; slug: string; updated_at: Date }>;
    const organization = rows[0];

    if (!organization) {
      throw new NotFoundError(`SCIM group ${id} not found.`);
    }

    return organization;
  }

  async patchGroup(id: number, operations: ScimPatchOperation[]) {
    for (const operation of operations) {
      if (operation.op.toLowerCase() !== "add" || operation.path !== "members") {
        continue;
      }

      const members = Array.isArray(operation.value)
        ? operation.value
        : operation.value
          ? [operation.value]
          : [];

      for (const member of members) {
        const userId = Number.parseInt(String((member as { value?: string }).value ?? ""), 10);

        if (Number.isInteger(userId) && userId > 0) {
          await this.members.addMember({ organizationId: id, userId, role: "member" });
        }
      }
    }

    const organization = await this.findOrganizationRecord(id);
    return await this.toScimGroup(organization);
  }

  private async toScimGroup(organization: {
    id: number;
    name: string;
    slug: string;
    updated_at: Date;
  }) {
    const members = await this.members.listForOrganization(organization.id);

    return {
      schemas: [SCIM_SCHEMAS.group],
      id: String(organization.id),
      displayName: organization.name,
      externalId: organization.slug,
      members: members.map((member) => ({
        value: String(member.user_id),
        display: String(member.user_id),
      })),
      meta: {
        resourceType: "Group",
        lastModified: organization.updated_at.toISOString(),
      },
    };
  }

  private toScimUser(user: {
    id: number;
    name: string;
    email: string;
    role: string;
    created_at?: Date;
    updated_at?: Date;
  }) {
    return {
      schemas: [SCIM_SCHEMAS.user],
      id: String(user.id),
      userName: user.email,
      name: { formatted: user.name },
      displayName: user.name,
      active: true,
      emails: [{ value: user.email, primary: true, type: "work" }],
      roles: [{ value: user.role, primary: true }],
      meta: {
        resourceType: "User",
        created: user.created_at?.toISOString(),
        lastModified: user.updated_at?.toISOString(),
      },
    };
  }
}

function createScimService(dependencies: AppDependencies): ScimService {
  return new ScimService(
    resolveService(dependencies, userRepositoryToken),
    new OrganizationMemberRepository(),
  );
}

export default ScimService;
export type { ScimPatchOperation, ScimUserPayload };
export { createScimService };
