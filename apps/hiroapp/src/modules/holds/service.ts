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
  holds_until?: string | null;
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

function parseHoldsUntil(value: string | null | undefined) {
  const raw = value?.trim() ?? "";
  if (!raw) {
    return null;
  }
  const holdsUntil = new Date(raw);
  if (Number.isNaN(holdsUntil.getTime())) {
    throw new UnprocessableEntityError("The hold-until date is invalid.");
  }
  if (holdsUntil.getTime() <= Date.now()) {
    throw new UnprocessableEntityError("The hold-until date must be in the future.");
  }
  return holdsUntil;
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
    holds_until: iso(record.holds_until),
    released_at: iso(record.released_at),
    created_at: iso(record.created_at),
    updated_at: iso(record.updated_at),
  };
}

export class ApplicationHoldService {
  private async releaseIfDue(
    row: ApplicationHold | ApplicationHoldRecord,
    now = new Date(),
  ): Promise<ApplicationHoldRecord> {
    const record =
      typeof (row as ApplicationHold).toObject === "function"
        ? (row as ApplicationHold).toObject()
        : (row as ApplicationHoldRecord);
    if (asHoldStatus(record.status) !== "holding") {
      return record;
    }
    if (!record.holds_until) {
      return record;
    }
    const holdsUntil = new Date(record.holds_until);
    if (Number.isNaN(holdsUntil.getTime()) || holdsUntil.getTime() > now.getTime()) {
      return record;
    }
    const updated = await applicationHolds.updateByIdOrThrow(record.id, {
      status: "released",
      released_by: null,
      released_at: new Date(),
    });
    await recordHiringEvent(
      "application.hold_expired",
      { hold_id: updated.id, application_id: updated.application_id },
      { type: "application_hold", id: updated.id },
    );
    return updated;
  }

  async serializedForApplication(applicationId: number) {
    const row = await applicationHolds.forApplication(applicationId);
    if (!row) {
      return null;
    }
    return serializeHold(await this.releaseIfDue(row));
  }

  async forApplication(actor: UserRecord, application: Application) {
    await assertCanView(actor, application);
    return this.serializedForApplication(Number(application.id));
  }

  async hold(actor: UserRecord, application: Application, input: CreateHoldInput = {}) {
    assertStaff(actor);
    assertOpenPipeline(application);
    const notes = input.notes?.trim() || null;
    const holdsUntil = parseHoldsUntil(input.holds_until);
    const existingRow = await applicationHolds.forApplication(Number(application.id));
    const existing = existingRow ? await this.releaseIfDue(existingRow) : null;
    if (existing && asHoldStatus(existing.status) === "holding") {
      throw new ConflictError("This application is already on hold.");
    }
    const saved = existing
      ? await applicationHolds.updateByIdOrThrow(existing.id, {
          created_by: actor.id,
          released_by: null,
          notes,
          status: "holding",
          holds_until: holdsUntil,
          released_at: null,
        })
      : await applicationHolds.create({
          application_id: Number(application.id),
          created_by: actor.id,
          released_by: null,
          tenant_id: currentTenantId(),
          notes,
          status: "holding",
          holds_until: holdsUntil,
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
    const current = await this.releaseIfDue(hold);
    if (asHoldStatus(current.status) !== "holding") {
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

  async releaseDue(now = new Date()) {
    const rows = await applicationHolds.findAll({ where: { status: "holding" } });
    let released = 0;
    for (const row of rows) {
      const fresh = await this.releaseIfDue(row, now);
      if (asHoldStatus(row.status) === "holding" && asHoldStatus(fresh.status) === "released") {
        released += 1;
      }
    }
    return released;
  }
}

export const holdService = new ApplicationHoldService();
