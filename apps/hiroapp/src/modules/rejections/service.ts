import { ForbiddenError, UnprocessableEntityError } from "@getstrata/core/errors/http";
import { currentTenantId } from "@getstrata/core/tenant/tenantContext";
import { recordHiringEvent } from "../../lib/hiringEvents.ts";
import { isStaff } from "../../lib/roles.ts";
import { iso } from "../../lib/serialize.ts";
import type { Application } from "../../models/Application.ts";
import type { ApplicationRejection } from "../../models/ApplicationRejection.ts";
import { applicationService } from "../applications/service.ts";
import type { UserRecord } from "../users/table.ts";
import { applicationRejections, rejectionReasons } from "./repository.ts";
import type { ApplicationRejectionRecord, RejectionReasonRecord } from "./table.ts";

export type RejectApplicationInput = {
  reason_id: number;
  notes?: string | null;
};

function assertStaff(actor: UserRecord) {
  if (!isStaff(actor.role_id)) {
    throw new ForbiddenError("Only staff can record rejection reasons.");
  }
}

export function serializeReason(row: RejectionReasonRecord) {
  return { id: Number(row.id), name: row.name };
}

export function serializeRejection(row: ApplicationRejection | ApplicationRejectionRecord) {
  const record =
    typeof (row as ApplicationRejection).toObject === "function"
      ? (row as ApplicationRejection).toObject()
      : (row as ApplicationRejectionRecord);
  return {
    id: Number(record.id),
    application_id: Number(record.application_id),
    reason_id: Number(record.reason_id),
    created_by: Number(record.created_by),
    notes: record.notes,
    created_at: iso(record.created_at),
    updated_at: iso(record.updated_at),
  };
}

export class RejectionService {
  async listReasons(actor: UserRecord) {
    assertStaff(actor);
    return (await rejectionReasons.ordered()).map(serializeReason);
  }

  async forApplication(actor: UserRecord, application: Application) {
    assertStaff(actor);
    const rows = await applicationRejections.forApplication(Number(application.id));
    return rows.map(serializeRejection);
  }

  async reject(actor: UserRecord, application: Application, input: RejectApplicationInput) {
    assertStaff(actor);
    const reason = await rejectionReasons.findById(Number(input.reason_id));
    if (!reason) {
      throw new UnprocessableEntityError("Unknown rejection reason.");
    }
    await applicationService.end(actor, application);
    const created = await applicationRejections.create({
      application_id: Number(application.id),
      reason_id: reason.id,
      created_by: actor.id,
      tenant_id: currentTenantId(),
      notes: input.notes?.trim() || null,
    });
    await recordHiringEvent(
      "application.rejected",
      {
        application_id: Number(application.id),
        reason_id: reason.id,
        user_id: Number(application.get("user_id")),
        created_by: actor.id,
      },
      { type: "application", id: Number(application.id) },
    );
    return created;
  }
}

export const rejectionService = new RejectionService();
