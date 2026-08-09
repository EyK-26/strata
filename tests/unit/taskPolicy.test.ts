import { afterEach, describe, expect, test } from "bun:test";
import { membershipContext } from "../../src/core/auth/membershipContext";
import { PolicyGate } from "../../src/core/auth/policy";
import TaskPolicy, { organizationIdForTask } from "../../src/modules/task/policy";
import type { TaskWithProjectRecord } from "../../src/modules/task/types";

const baseTask: TaskWithProjectRecord = {
  id: 1,
  project_id: 10,
  tenant_id: 1,
  title: "Ship release",
  status: "todo",
  priority: 0,
  created_at: new Date(),
  updated_at: new Date(),
  deleted_at: null,
};

const taskWithOrganization: TaskWithProjectRecord = {
  ...baseTask,
  project: {
    id: 10,
    name: "Platform",
    organization_id: 5,
  },
};

function createGate(): PolicyGate {
  const gate = new PolicyGate();
  gate.register("task", new TaskPolicy());
  return gate;
}

function withMembership<T>(
  organizationIds: number[],
  roles: Array<[number, "member" | "admin" | "owner"]>,
  callback: () => T,
): T {
  return membershipContext.run(
    {
      organizationIds,
      rolesByOrganizationId: new Map(roles),
    },
    callback,
  );
}

describe("TaskPolicy", () => {
  const originalPublicReads = process.env.FEATURE_PUBLIC_READS;

  afterEach(() => {
    if (originalPublicReads === undefined) {
      delete process.env.FEATURE_PUBLIC_READS;
    } else {
      process.env.FEATURE_PUBLIC_READS = originalPublicReads;
    }
  });

  test("requires authentication to create tasks", () => {
    expect(organizationIdForTask(taskWithOrganization)).toBe(5);
    expect(organizationIdForTask(baseTask)).toBeNull();

    const gate = createGate();

    expect(gate.allows("task", "create", null)).toBe(false);
    expect(gate.allows("task", "create", { id: 1, role: "member" })).toBe(true);
  });

  test("allows guests to view tasks when public reads are enabled", () => {
    process.env.FEATURE_PUBLIC_READS = "true";
    const gate = createGate();

    expect(gate.allows("task", "view", null, taskWithOrganization)).toBe(true);
  });

  test("denies guest views when public reads are disabled", () => {
    process.env.FEATURE_PUBLIC_READS = "false";
    const gate = createGate();

    expect(gate.allows("task", "view", null, taskWithOrganization)).toBe(false);
  });

  test("allows global admins to view tasks without organization scope", () => {
    const gate = createGate();

    expect(gate.allows("task", "view", { id: 1, role: "admin" }, baseTask)).toBe(true);
  });

  test("allows organization members to view tasks in their organizations", () => {
    const gate = createGate();

    expect(
      withMembership([5], [[5, "member"]], () =>
        gate.allows("task", "view", { id: 2, role: "member" }, taskWithOrganization),
      ),
    ).toBe(true);

    expect(
      withMembership([9], [[9, "member"]], () =>
        gate.allows("task", "view", { id: 2, role: "member" }, taskWithOrganization),
      ),
    ).toBe(false);
  });

  test("allows members to update tasks and admins to delete them", () => {
    const gate = createGate();

    expect(gate.allows("task", "update", null, taskWithOrganization)).toBe(false);
    expect(gate.allows("task", "delete", null, taskWithOrganization)).toBe(false);

    expect(
      withMembership([5], [[5, "member"]], () =>
        gate.allows("task", "update", { id: 2, role: "member" }, taskWithOrganization),
      ),
    ).toBe(true);

    expect(
      withMembership([5], [[5, "member"]], () =>
        gate.allows("task", "delete", { id: 2, role: "member" }, taskWithOrganization),
      ),
    ).toBe(false);

    expect(
      withMembership([5], [[5, "admin"]], () =>
        gate.allows("task", "delete", { id: 2, role: "member" }, taskWithOrganization),
      ),
    ).toBe(true);
  });

  test("allows global admins to mutate tasks without organization scope", () => {
    const gate = createGate();
    const policy = new TaskPolicy();
    const admin = { id: 1, role: "admin" };

    expect(gate.allows("task", "update", admin, baseTask)).toBe(true);
    expect(gate.allows("task", "delete", admin, baseTask)).toBe(true);
    expect(gate.allows("task", "update", admin, taskWithOrganization)).toBe(true);
    expect(gate.allows("task", "delete", admin, taskWithOrganization)).toBe(true);
    expect(policy.create(null)).toBe(false);
    expect(policy.view({ id: 2, role: "member" }, baseTask)).toBe(false);
    expect(policy.update(null, baseTask)).toBe(false);
    expect(policy.delete(null, baseTask)).toBe(false);
  });
});
