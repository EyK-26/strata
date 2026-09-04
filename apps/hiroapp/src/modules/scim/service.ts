import { hashPassword } from "@getstrata/core/auth/password";
import { NotFoundError } from "@getstrata/core/errors/http";
import { currentTenantId } from "@getstrata/core/tenant/tenantContext";
import { isCandidate, isStaff, ROLE } from "../../lib/roles.ts";
import { departments } from "../departments/repository.ts";
import { departmentMembers } from "../teams/memberRepository.ts";
import { type UserRecord, users } from "../users/repository.ts";
import { SCIM_SCHEMAS, type ScimPatchOperation, type ScimUserPayload } from "./schemas.ts";

function splitName(payload: ScimUserPayload, email: string) {
  const given = payload.name?.givenName?.trim();
  const family = payload.name?.familyName?.trim();
  if (given || family) {
    return { first: given || "Staff", last: family || "Member" };
  }
  const formatted = payload.name?.formatted?.trim() || email.split("@")[0] || "Staff Member";
  const parts = formatted.split(/\s+/);
  return { first: parts[0] ?? "Staff", last: parts.slice(1).join(" ") || "Member" };
}

function roleValues(payload: ScimUserPayload): string[] {
  return (payload.roles ?? []).map((entry) =>
    String(typeof entry === "string" ? entry : (entry.value ?? "")).toLowerCase(),
  );
}

export function isCandidateShaped(payload: ScimUserPayload): boolean {
  const userType = String(payload.userType ?? "").toLowerCase();
  if (userType === "candidate" || userType === "applicant") {
    return true;
  }
  return roleValues(payload).some((value) => value === "candidate" || value === "applicant");
}

function staffRoleId(payload: ScimUserPayload): number {
  return roleValues(payload).some((value) => value === "admin") ? ROLE.ADMIN : ROLE.RECRUITER;
}

export class ScimService {
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
    const offset = Math.max(startIndex - 1, 0);
    const records = (await users.search("")).filter((user) => isStaff(user.role_id));
    const page = records.slice(offset, offset + count);
    return {
      schemas: [SCIM_SCHEMAS.listResponse],
      totalResults: records.length,
      startIndex,
      itemsPerPage: page.length,
      Resources: page.map((user) => this.toScimUser(user)),
    };
  }

  async findStaffUser(id: number): Promise<UserRecord> {
    const user = await users.findById(id);
    if (!user || !isStaff(user.role_id)) {
      throw new NotFoundError(`SCIM user ${id} not found.`);
    }
    return user;
  }

  async getUser(id: number) {
    return this.toScimUser(await this.findStaffUser(id));
  }

  async createUser(payload: ScimUserPayload) {
    if (isCandidateShaped(payload)) {
      return { ignored: true as const };
    }
    const email =
      payload.userName?.trim().toLowerCase() ??
      payload.emails
        ?.find((entry) => entry.primary)
        ?.value?.trim()
        .toLowerCase() ??
      payload.emails?.[0]?.value?.trim().toLowerCase();
    if (!email) {
      throw new Error("SCIM userName or email is required.");
    }
    const existing = await users.findByEmail(email);
    if (existing && isCandidate(existing.role_id)) {
      return { ignored: true as const };
    }
    if (existing && isStaff(existing.role_id)) {
      return this.toScimUser(existing);
    }
    const name = splitName(payload, email);
    const user = await users.create({
      first_name: name.first,
      last_name: name.last,
      email,
      password: await hashPassword(crypto.randomUUID()),
      role_id: staffRoleId(payload),
      tenant_id: currentTenantId(),
    });
    return this.toScimUser(user);
  }

  async patchUser(id: number, operations: ScimPatchOperation[]) {
    const user = await this.findStaffUser(id);
    const changes: Partial<UserRecord> = {};
    for (const operation of operations) {
      if (operation.op.toLowerCase() !== "replace") {
        continue;
      }
      if (operation.path === "name.formatted" || operation.path === "displayName") {
        const parts = String(operation.value ?? "").split(/\s+/);
        changes.first_name = parts[0] || user.first_name;
        changes.last_name = parts.slice(1).join(" ") || user.last_name;
      }
      if (operation.path === "userName" || operation.path === 'emails[type eq "work"].value') {
        changes.email = String(operation.value ?? user.email).toLowerCase();
      }
    }
    const updated = await users.updateByIdOrThrow(id, changes);
    return this.toScimUser(updated);
  }

  async deleteUser(id: number) {
    await this.findStaffUser(id);
    await users.deleteById(id);
  }

  async listGroups(startIndex = 1, count = 100) {
    const offset = Math.max(startIndex - 1, 0);
    const records = await departments.ordered();
    const page = records.slice(offset, offset + count);
    const resources = await Promise.all(page.map((row) => this.toScimGroup(row)));
    return {
      schemas: [SCIM_SCHEMAS.listResponse],
      totalResults: records.length,
      startIndex,
      itemsPerPage: resources.length,
      Resources: resources,
    };
  }

  async getGroup(id: number) {
    const department = await departments.findById(id);
    if (!department) {
      throw new NotFoundError(`SCIM group ${id} not found.`);
    }
    return this.toScimGroup(department);
  }

  async patchGroup(id: number, operations: ScimPatchOperation[]) {
    const department = await departments.findById(id);
    if (!department) {
      throw new NotFoundError(`SCIM group ${id} not found.`);
    }
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
        if (!Number.isInteger(userId) || userId <= 0) {
          continue;
        }
        const user = await users.findById(userId);
        if (!user || !isStaff(user.role_id)) {
          continue;
        }
        const existing = await departmentMembers.findMembership(id, userId);
        if (!existing) {
          await departmentMembers.create({
            department_id: id,
            user_id: userId,
            role: "member",
            created_at: new Date(),
          });
        }
      }
    }
    return this.toScimGroup(department);
  }

  private async toScimGroup(department: { id: number; name: string; updated_at: Date | null }) {
    const members = await departmentMembers.forDepartment(department.id);
    return {
      schemas: [SCIM_SCHEMAS.group],
      id: String(department.id),
      displayName: department.name,
      members: members.map((member) => ({
        value: String(member.user_id),
        display: String(member.user_id),
      })),
      meta: {
        resourceType: "Group",
        lastModified: department.updated_at?.toISOString() ?? undefined,
      },
    };
  }

  private toScimUser(user: UserRecord) {
    const displayName = `${user.first_name} ${user.last_name}`.trim();
    return {
      schemas: [SCIM_SCHEMAS.user],
      id: String(user.id),
      userName: user.email,
      name: { formatted: displayName, givenName: user.first_name, familyName: user.last_name },
      displayName,
      active: true,
      emails: [{ value: user.email, primary: true, type: "work" }],
      roles: [{ value: user.role_id === ROLE.ADMIN ? "admin" : "recruiter", primary: true }],
      meta: {
        resourceType: "User",
        created: user.created_at instanceof Date ? user.created_at.toISOString() : undefined,
        lastModified: user.updated_at instanceof Date ? user.updated_at.toISOString() : undefined,
      },
    };
  }
}

export const scimService = new ScimService();
