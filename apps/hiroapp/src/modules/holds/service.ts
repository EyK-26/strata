import {
  ConflictError,
  ForbiddenError,
  UnprocessableEntityError,
} from "@getstrata/core/errors/http";
import { currentTenantId } from "@getstrata/core/tenant/tenantContext";
import { recordHiringEvent } from "../../lib/hiringEvents.ts";
import { isStaff, STATUS } from "../../lib/roles.ts";
import { iso } from "../../lib/serialize.ts";
import type { Application } from "../../models/Application.ts";
import type { ApplicationHold } from "../../models/ApplicationHold.ts";
import type { UserRecord } from "../users/table.ts";
import { applicationHolds } from "./repository.ts";
import type { ApplicationHoldRecord, HoldStatus } from "./table.ts";

export type CreateHoldInput = {
  notes?: string | null;
};

function asHoldStatus(value: unknown): HoldStatus {
  if (value === "holding" || value === "released") {
    return value;
  }
  return "released";
}

function assertStaff(actor: UserRecord) {
  if (!isStaff(actor.role_id)) {
    throw new ForbiddenError("Only staff can manage application holds.");
  }
}

async function assertCanView(actor: UserRecord, application: Application) {
  if (isStaff(actor.role_id)) {
    return;
  }
  if (Number(application.get("user_id")) !== Number(actor.id)) {
    throw new ForbiddenError("You cannot view this hold.");
  }
}

function assertOpenPipeline(application: Application) {
  const statusId = Number(application.get("status_id"));
  if (statusId === STATUS.HIRED || statusId === STATUS.ENDED) {
    throw new UnprocessableEntityError("A hired or ended application cannot be held.");
  }
}

export function serializeHold(row: ApplicationHold | ApplicationHoldRecord) {
  const record =
    typeof (row as ApplicationHold).toObject === "function"
      ? (row as ApplicationHold).toObject()
      : (row as ApplicationHoldRecord);
  return {
    id: Number(record.id),
    application_id: Number(record.application_id),
    created_by: Number(record.created_by),
    released_by: record.released_by == null ? null : Number(record.released_by),
    notes: record.notes,
    status: asHoldStatus(record.status),
    released_at: iso(record.released_at),
    created_at: iso(record.created_at),
    updated_at: iso(record.updated_at),
  };
}

export class ApplicationHoldService {
  async forApplication(actor: UserRecord, application: Application) {
    await assertCanView(actor, application);
    const row = await applicationHolds.forApplication(Number(application.id));
    return row ? serializeHold(row) : null;
  }

  async hold(actor: UserRecord, application: Application, input: CreateHoldInput = {}) {
    assertStaff(actor);
    assertOpenPipeline(application);
    const notes = input.notes?.trim() || null;
    const existing = await applicationHolds.forApplication(Number(application.id));
    if (existing && asHoldStatus(existing.status) === "holding") {
      throw new ConflictError("This application is already on hold.");
    }
    const saved = existing
      ? await applicationHolds.updateByIdOrThrow(existing.id, {
          created_by: actor.id,
          released_by: null,
          notes,
          status: "holding",
          released_at: null,
        })
      : await applicationHolds.create({
          application_id: Number(application.id),
          created_by: actor.id,
          released_by: null,
          tenant_id: currentTenantId(),
          notes,
          status: "holding",
          released_at: null,
        });
    await recordHiringEvent(
      existing ? "application.reheld" : "application.held",
      {
        hold_id: saved.id,
        application_id: saved.application_id,
        created_by: actor.id,
      },
      { type: "application_hold", id: saved.id },
    );
    return saved;
  }

  async release(actor: UserRecord, hold: ApplicationHold) {
    assertStaff(actor);
    if (asHoldStatus(hold.get("status")) !== "holding") {
      throw new ForbiddenError("This application is not on hold.");
    }
    const updated = await applicationHolds.updateByIdOrThrow(Number(hold.id), {
      status: "released",
      released_by: actor.id,
      released_at: new Date(),
    });
    await recordHiringEvent(
      "application.hold_released",
      { hold_id: updated.id, application_id: updated.application_id, released_by: actor.id },
      { type: "application_hold", id: updated.id },
    );
    return updated;
  }
}

export const holdService = new ApplicationHoldService();
