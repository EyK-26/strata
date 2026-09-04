import { ForbiddenError, UnprocessableEntityError } from "@getstrata/core/errors/http";
import { currentTenantId } from "@getstrata/core/tenant/tenantContext";
import { recordHiringEvent } from "../../lib/hiringEvents.ts";
import { isStaff } from "../../lib/roles.ts";
import { iso } from "../../lib/serialize.ts";
import type { OfferTemplate } from "../../models/OfferTemplate.ts";
import type { UserRecord } from "../users/table.ts";
import { offerTemplates } from "./repository.ts";
import type { OfferTemplateRecord } from "./table.ts";

export type CreateTemplateInput = {
  name: string;
  body: string;
  salary?: number | null;
};

export type UpdateTemplateInput = {
  name?: string;
  body?: string;
  salary?: number | null;
};

export type MaterializeInput = {
  salary?: number | null;
  notes?: string | null;
};

function assertStaff(actor: UserRecord) {
  if (!isStaff(actor.role_id)) {
    throw new ForbiddenError("Only staff can manage offer templates.");
  }
}

function parseName(value: string) {
  const name = value.trim();
  if (!name) {
    throw new UnprocessableEntityError("A template name is required.");
  }
  return name;
}

function parseBody(value: string) {
  const body = value.trim();
  if (!body) {
    throw new UnprocessableEntityError("A template body is required.");
  }
  return body;
}

function parseSalary(value: number | null | undefined) {
  if (value == null) {
    return null;
  }
  const salary = Number(value);
  if (!Number.isInteger(salary) || salary <= 0) {
    throw new UnprocessableEntityError("Salary must be a positive integer.");
  }
  return salary;
}

export function serializeOfferTemplate(row: OfferTemplate | OfferTemplateRecord) {
  const record =
    typeof (row as OfferTemplate).toObject === "function"
      ? (row as OfferTemplate).toObject()
      : (row as OfferTemplateRecord);
  return {
    id: Number(record.id),
    created_by: Number(record.created_by),
    name: record.name,
    body: record.body,
    salary: record.salary == null ? null : Number(record.salary),
    created_at: iso(record.created_at),
    updated_at: iso(record.updated_at),
  };
}

export class OfferTemplateService {
  async list(actor: UserRecord) {
    assertStaff(actor);
    return (await offerTemplates.ordered()).map(serializeOfferTemplate);
  }

  async create(actor: UserRecord, input: CreateTemplateInput) {
    assertStaff(actor);
    const created = await offerTemplates.create({
      created_by: actor.id,
      tenant_id: currentTenantId(),
      name: parseName(String(input.name ?? "")),
      body: parseBody(String(input.body ?? "")),
      salary: parseSalary(input.salary),
    });
    await recordHiringEvent(
      "offer_template.created",
      { template_id: created.id, name: created.name, salary: created.salary },
      { type: "offer_template", id: created.id },
    );
    return created;
  }

  async update(actor: UserRecord, template: OfferTemplate, input: UpdateTemplateInput) {
    assertStaff(actor);
    const changes: Partial<Pick<OfferTemplateRecord, "name" | "body" | "salary">> = {};
    if (input.name !== undefined) {
      changes.name = parseName(String(input.name ?? ""));
    }
    if (input.body !== undefined) {
      changes.body = parseBody(String(input.body ?? ""));
    }
    if (input.salary !== undefined) {
      changes.salary = parseSalary(input.salary);
    }
    if (Object.keys(changes).length === 0) {
      throw new UnprocessableEntityError("No template fields to update.");
    }
    const updated = await offerTemplates.updateByIdOrThrow(Number(template.id), changes);
    await recordHiringEvent(
      "offer_template.updated",
      { template_id: updated.id, name: updated.name, salary: updated.salary },
      { type: "offer_template", id: updated.id },
    );
    return updated;
  }

  async remove(actor: UserRecord, template: OfferTemplate) {
    assertStaff(actor);
    const id = Number(template.id);
    await offerTemplates.deleteById(id);
    await recordHiringEvent(
      "offer_template.deleted",
      { template_id: id },
      { type: "offer_template", id },
    );
    return { id };
  }

  async materialize(actor: UserRecord, template: OfferTemplate, input: MaterializeInput = {}) {
    assertStaff(actor);
    const override = input.salary == null ? null : parseSalary(input.salary);
    const stored = template.get("salary");
    const salary = override ?? (stored == null ? null : Number(stored));
    if (salary == null || !Number.isInteger(salary) || salary <= 0) {
      throw new UnprocessableEntityError("Salary must be a positive integer.");
    }
    const notes = input.notes?.trim() || String(template.get("body"));
    return { salary, notes };
  }
}

export const offerTemplateService = new OfferTemplateService();
