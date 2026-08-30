import { repositoryConnection as db } from "@getstrata/core/database/repositoryConnection";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asPositiveInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    return parsed > 0 ? parsed : null;
  }

  return null;
}

function matchesWebhookOrganization(
  webhookOrganizationId: number | null,
  payloadOrganizationId: number | null,
): boolean {
  if (webhookOrganizationId == null) {
    return true;
  }

  return payloadOrganizationId === webhookOrganizationId;
}

function organizationIdFromWebhookPayload(payload: Record<string, unknown>): number | null {
  const direct = asPositiveInt(payload.organization_id);

  if (direct !== null) {
    return direct;
  }

  const nested = isRecord(payload.payload) ? payload.payload : null;

  if (nested) {
    const nestedOrg = asPositiveInt(nested.organization_id);

    if (nestedOrg !== null) {
      return nestedOrg;
    }

    if (payload.table === "organization") {
      return asPositiveInt(nested.id);
    }
  }

  if (payload.table === "organization") {
    return asPositiveInt(payload.id);
  }

  return null;
}

async function organizationIdForProject(projectId: number): Promise<number | null> {
  const rows = (await db`
    SELECT organization_id
    FROM project
    WHERE id = ${projectId}
    LIMIT 1
  `) as Array<{ organization_id: number }>;

  return asPositiveInt(rows[0]?.organization_id);
}

async function organizationIdForTask(taskId: number): Promise<number | null> {
  const rows = (await db`
    SELECT project.organization_id
    FROM task
    INNER JOIN project ON project.id = task.project_id
    WHERE task.id = ${taskId}
    LIMIT 1
  `) as Array<{ organization_id: number }>;

  return asPositiveInt(rows[0]?.organization_id);
}

async function resolveWebhookOrganizationId(
  payload: Record<string, unknown>,
): Promise<number | null> {
  const fromPayload = organizationIdFromWebhookPayload(payload);

  if (fromPayload !== null) {
    return fromPayload;
  }

  const entity = isRecord(payload.payload) ? payload.payload : payload;
  const projectId = asPositiveInt(entity.project_id);

  if (projectId !== null) {
    return await organizationIdForProject(projectId);
  }

  const taskId = asPositiveInt(entity.task_id);

  if (taskId !== null) {
    return await organizationIdForTask(taskId);
  }

  return null;
}

export {
  matchesWebhookOrganization,
  organizationIdFromWebhookPayload,
  resolveWebhookOrganizationId,
};
