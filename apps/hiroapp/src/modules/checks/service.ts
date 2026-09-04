import {
  ConflictError,
  ForbiddenError,
  UnprocessableEntityError,
} from "@getstrata/core/errors/http";
import { currentTenantId } from "@getstrata/core/tenant/tenantContext";
import { recordHiringEvent } from "../../lib/hiringEvents.ts";
import { isStaff } from "../../lib/roles.ts";
import { iso } from "../../lib/serialize.ts";
import type { Application } from "../../models/Application.ts";
import type { BackgroundCheck } from "../../models/BackgroundCheck.ts";
import type { UserRecord } from "../users/table.ts";
import { backgroundChecks } from "./repository.ts";
import type { BackgroundCheckRecord, BackgroundCheckStatus } from "./table.ts";

export type RequestCheckInput = {
  vendor?: string | null;
  notes?: string | null;
};

function asCheckStatus(value: unknown): BackgroundCheckStatus {
  if (value === "requested" || value === "clear" || value === "flagged" || value === "cancelled") {
    return value;
  }
  return "requested";
}

function assertStaff(actor: UserRecord) {
  if (!isStaff(actor.role_id)) {
    throw new ForbiddenError("Only staff can manage background checks.");
  }
}

async function assertCanView(actor: UserRecord, application: Application) {
  if (isStaff(actor.role_id)) {
    return;
  }
  if (Number(application.get("user_id")) !== Number(actor.id)) {
    throw new ForbiddenError("You cannot view this background check.");
  }
}

function parseVendor(value: string | null | undefined) {
  const vendor = value?.trim() || null;
  return vendor;
}

export function serializeBackgroundCheck(row: BackgroundCheck | BackgroundCheckRecord) {
  const record =
    typeof (row as BackgroundCheck).toObject === "function"
      ? (row as BackgroundCheck).toObject()
      : (row as BackgroundCheckRecord);
  return {
    id: Number(record.id),
    application_id: Number(record.application_id),
    created_by: Number(record.created_by),
    vendor: record.vendor,
    notes: record.notes,
    status: asCheckStatus(record.status),
    completed_at: iso(record.completed_at),
    created_at: iso(record.created_at),
    updated_at: iso(record.updated_at),
  };
}

export class BackgroundCheckService {
  async forApplication(actor: UserRecord, application: Application) {
    await assertCanView(actor, application);
    const row = await backgroundChecks.forApplication(Number(application.id));
    return row ? serializeBackgroundCheck(row) : null;
  }

  async request(actor: UserRecord, application: Application, input: RequestCheckInput = {}) {
    assertStaff(actor);
    const vendor = parseVendor(input.vendor);
    const notes = input.notes?.trim() || null;
    const existing = await backgroundChecks.forApplication(Number(application.id));
    if (existing) {
      const status = asCheckStatus(existing.status);
      if (status === "requested") {
        throw new ConflictError("This application already has a requested background check.");
      }
      if (status === "clear" || status === "flagged") {
        throw new ForbiddenError("This application already has a completed background check.");
      }
      const reopened = await backgroundChecks.updateByIdOrThrow(existing.id, {
        created_by: actor.id,
        vendor,
        notes,
        status: "requested",
        completed_at: null,
      });
      await recordHiringEvent(
        "background_check.requested",
        {
          background_check_id: reopened.id,
          application_id: reopened.application_id,
          vendor,
        },
        { type: "background_check", id: reopened.id },
      );
      return reopened;
    }
    const created = await backgroundChecks.create({
      application_id: Number(application.id),
      created_by: actor.id,
      tenant_id: currentTenantId(),
      vendor,
      notes,
      status: "requested",
      completed_at: null,
    });
    await recordHiringEvent(
      "background_check.requested",
      {
        background_check_id: created.id,
        application_id: created.application_id,
        vendor,
      },
      { type: "background_check", id: created.id },
    );
    return created;
  }

  async record(
    actor: UserRecord,
    check: BackgroundCheck,
    decision: "clear" | "flagged",
    notes?: string | null,
  ) {
    assertStaff(actor);
    if (asCheckStatus(check.get("status")) !== "requested") {
      throw new ForbiddenError("Only a requested check can be recorded.");
    }
    if (decision !== "clear" && decision !== "flagged") {
      throw new UnprocessableEntityError("The check result is invalid.");
    }
    const updated = await backgroundChecks.updateByIdOrThrow(Number(check.id), {
      status: decision,
      notes: notes?.trim() || check.get("notes") || null,
      completed_at: new Date(),
    });
    await recordHiringEvent(
      decision === "clear" ? "background_check.cleared" : "background_check.flagged",
      { background_check_id: updated.id, application_id: updated.application_id },
      { type: "background_check", id: updated.id },
    );
    return updated;
  }

  async clear(actor: UserRecord, check: BackgroundCheck, notes?: string | null) {
    return this.record(actor, check, "clear", notes);
  }

  async flag(actor: UserRecord, check: BackgroundCheck, notes?: string | null) {
    return this.record(actor, check, "flagged", notes);
  }

  async cancel(actor: UserRecord, check: BackgroundCheck) {
    assertStaff(actor);
    if (asCheckStatus(check.get("status")) !== "requested") {
      throw new ForbiddenError("Only a requested check can be cancelled.");
    }
    const updated = await backgroundChecks.updateByIdOrThrow(Number(check.id), {
      status: "cancelled",
      completed_at: new Date(),
    });
    await recordHiringEvent(
      "background_check.cancelled",
      { background_check_id: updated.id, application_id: updated.application_id },
      { type: "background_check", id: updated.id },
    );
    return updated;
  }
}

export const backgroundCheckService = new BackgroundCheckService();
