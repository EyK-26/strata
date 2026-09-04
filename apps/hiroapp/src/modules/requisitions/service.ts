import { ConflictError, ForbiddenError } from "@getstrata/core/errors/http";
import { currentTenantId } from "@getstrata/core/tenant/tenantContext";
import { recordHiringEvent } from "../../lib/hiringEvents.ts";
import { isAdmin, isStaff } from "../../lib/roles.ts";
import { iso } from "../../lib/serialize.ts";
import type { Position } from "../../models/Position.ts";
import type { Requisition } from "../../models/Requisition.ts";
import type { UserRecord } from "../users/table.ts";
import { requisitions } from "./repository.ts";
import type { RequisitionRecord, RequisitionStatus } from "./table.ts";

export type SubmitRequisitionInput = {
  notes?: string | null;
};

function asRequisitionStatus(value: unknown): RequisitionStatus {
  if (value === "submitted" || value === "approved" || value === "rejected") {
    return value;
  }
  return "submitted";
}

function assertStaff(actor: UserRecord) {
  if (!isStaff(actor.role_id)) {
    throw new ForbiddenError("Only staff can manage position requisitions.");
  }
}

function assertAdmin(actor: UserRecord) {
  if (!isAdmin(actor.role_id)) {
    throw new ForbiddenError("Only an admin can approve or reject a requisition.");
  }
}

export function serializeRequisition(row: Requisition | RequisitionRecord) {
  const record =
    typeof (row as Requisition).toObject === "function"
      ? (row as Requisition).toObject()
      : (row as RequisitionRecord);
  return {
    id: Number(record.id),
    position_id: Number(record.position_id),
    requested_by: Number(record.requested_by),
    approved_by: record.approved_by == null ? null : Number(record.approved_by),
    notes: record.notes,
    status: asRequisitionStatus(record.status),
    created_at: iso(record.created_at),
    updated_at: iso(record.updated_at),
  };
}

export class RequisitionService {
  async forPosition(actor: UserRecord, position: Position) {
    assertStaff(actor);
    const row = await requisitions.forPosition(Number(position.id));
    return row ? serializeRequisition(row) : null;
  }

  async submit(actor: UserRecord, position: Position, input: SubmitRequisitionInput = {}) {
    assertStaff(actor);
    const notes = input.notes?.trim() || null;
    const existing = await requisitions.forPosition(Number(position.id));
    if (existing) {
      const status = asRequisitionStatus(existing.status);
      if (status === "submitted") {
        throw new ConflictError("This position already has a submitted requisition.");
      }
      if (status === "approved") {
        throw new ForbiddenError("This position requisition is already approved.");
      }
      const resubmitted = await requisitions.updateByIdOrThrow(existing.id, {
        requested_by: actor.id,
        approved_by: null,
        notes,
        status: "submitted",
      });
      await recordHiringEvent(
        "requisition.submitted",
        { requisition_id: resubmitted.id, position_id: resubmitted.position_id },
        { type: "position_requisition", id: resubmitted.id },
      );
      return resubmitted;
    }
    const created = await requisitions.create({
      position_id: Number(position.id),
      requested_by: actor.id,
      approved_by: null,
      tenant_id: currentTenantId(),
      notes,
      status: "submitted",
    });
    await recordHiringEvent(
      "requisition.submitted",
      { requisition_id: created.id, position_id: created.position_id },
      { type: "position_requisition", id: created.id },
    );
    return created;
  }

  async approve(actor: UserRecord, requisition: Requisition) {
    assertAdmin(actor);
    if (asRequisitionStatus(requisition.get("status")) !== "submitted") {
      throw new ForbiddenError("Only a submitted requisition can be approved.");
    }
    const updated = await requisitions.updateByIdOrThrow(Number(requisition.id), {
      status: "approved",
      approved_by: actor.id,
    });
    await recordHiringEvent(
      "requisition.approved",
      { requisition_id: updated.id, position_id: updated.position_id, approved_by: actor.id },
      { type: "position_requisition", id: updated.id },
    );
    return updated;
  }

  async reject(actor: UserRecord, requisition: Requisition, notes?: string | null) {
    assertAdmin(actor);
    if (asRequisitionStatus(requisition.get("status")) !== "submitted") {
      throw new ForbiddenError("Only a submitted requisition can be rejected.");
    }
    const updated = await requisitions.updateByIdOrThrow(Number(requisition.id), {
      status: "rejected",
      approved_by: actor.id,
      notes: notes?.trim() || requisition.get("notes") || null,
    });
    await recordHiringEvent(
      "requisition.rejected",
      { requisition_id: updated.id, position_id: updated.position_id, approved_by: actor.id },
      { type: "position_requisition", id: updated.id },
    );
    return updated;
  }
}

export const requisitionService = new RequisitionService();
