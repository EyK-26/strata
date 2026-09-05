import {
  ConflictError,
  ForbiddenError,
  UnprocessableEntityError,
  ValidationError,
} from "@getstrata/core/errors/http";
import { currentTenantId } from "@getstrata/core/tenant/tenantContext";
import { recordHiringEvent } from "../../lib/hiringEvents.ts";
import { isCandidate, isStaff } from "../../lib/roles.ts";
import { iso } from "../../lib/serialize.ts";
import type { Application } from "../../models/Application.ts";
import type { TalentPoolEntry } from "../../models/TalentPoolEntry.ts";
import { applications } from "../applications/repository.ts";
import { contactUserNotification, notifyUser } from "../notifications/service.ts";
import { users } from "../users/repository.ts";
import type { UserRecord } from "../users/table.ts";
import { talentPool } from "./repository.ts";
import type { TalentPoolEntryRecord, TalentPoolStatus } from "./table.ts";

export type AddPoolInput = {
  user_id: number;
  notes?: string | null;
  application_id?: number | null;
};

export type ReachOutInput = {
  subject?: string | null;
  text: string;
};

function asPoolStatus(value: unknown): TalentPoolStatus {
  if (value === "active" || value === "released") {
    return value;
  }
  return "active";
}

function assertStaff(actor: UserRecord) {
  if (!isStaff(actor.role_id)) {
    throw new ForbiddenError("Only staff can manage the talent pool.");
  }
}

function sourceApplicationId(value: number | null | undefined) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }
  return id;
}

export function serializePoolEntry(row: TalentPoolEntry | TalentPoolEntryRecord) {
  const record =
    typeof (row as TalentPoolEntry).toObject === "function"
      ? (row as TalentPoolEntry).toObject()
      : (row as TalentPoolEntryRecord);
  return {
    id: Number(record.id),
    user_id: Number(record.user_id),
    created_by: Number(record.created_by),
    source_application_id:
      record.source_application_id == null ? null : Number(record.source_application_id),
    notes: record.notes,
    status: asPoolStatus(record.status),
    created_at: iso(record.created_at),
    updated_at: iso(record.updated_at),
  };
}

export class TalentPoolService {
  async list(actor: UserRecord) {
    assertStaff(actor);
    const rows = await talentPool.findAll({
      orderBy: { column: "created_at", direction: "DESC" },
    });
    return Promise.all(
      rows.map(async (row) => {
        const user = await users.findById(row.user_id);
        return {
          ...serializePoolEntry(row),
          user: user
            ? {
                id: user.id,
                first_name: user.first_name,
                last_name: user.last_name,
                email: user.email,
              }
            : null,
        };
      }),
    );
  }

  async forApplication(actor: UserRecord, application: Application) {
    assertStaff(actor);
    const row = await talentPool.findByUser(Number(application.get("user_id")));
    return row ? serializePoolEntry(row) : null;
  }

  async add(actor: UserRecord, input: AddPoolInput) {
    assertStaff(actor);
    const candidate = await users.findById(Number(input.user_id));
    if (!candidate) {
      throw new UnprocessableEntityError("Unknown candidate.");
    }
    if (!isCandidate(candidate.role_id)) {
      throw new UnprocessableEntityError("Only candidates can be added to the talent pool.");
    }
    const sourceId = sourceApplicationId(input.application_id);
    if (sourceId != null) {
      const application = await applications.findById(sourceId);
      if (!application || Number(application.user_id) !== Number(candidate.id)) {
        throw new UnprocessableEntityError(
          "The source application does not belong to this candidate.",
        );
      }
    }
    const notes = input.notes?.trim() || null;
    const existing = await talentPool.findByUser(candidate.id);
    if (existing && asPoolStatus(existing.status) === "active") {
      throw new ConflictError("This candidate is already in the talent pool.");
    }
    const saved = existing
      ? await talentPool.updateByIdOrThrow(existing.id, {
          created_by: actor.id,
          source_application_id: sourceId,
          notes,
          status: "active",
        })
      : await talentPool.create({
          user_id: candidate.id,
          created_by: actor.id,
          tenant_id: currentTenantId(),
          source_application_id: sourceId,
          notes,
          status: "active",
        });
    await recordHiringEvent(
      existing ? "talent_pool.reactivated" : "talent_pool.added",
      {
        talent_pool_id: saved.id,
        user_id: saved.user_id,
        source_application_id: saved.source_application_id,
        created_by: actor.id,
      },
      { type: "talent_pool_entry", id: saved.id },
    );
    return saved;
  }

  async addFromApplication(
    actor: UserRecord,
    application: Application,
    input: { notes?: string | null } = {},
  ) {
    return this.add(actor, {
      user_id: Number(application.get("user_id")),
      notes: input.notes,
      application_id: Number(application.id),
    });
  }

  async release(actor: UserRecord, entry: TalentPoolEntry) {
    assertStaff(actor);
    if (asPoolStatus(entry.get("status")) !== "active") {
      throw new ForbiddenError("This candidate is not in the talent pool.");
    }
    const updated = await talentPool.updateByIdOrThrow(Number(entry.id), { status: "released" });
    await recordHiringEvent(
      "talent_pool.released",
      { talent_pool_id: updated.id, user_id: updated.user_id },
      { type: "talent_pool_entry", id: updated.id },
    );
    return updated;
  }

  async reachOut(actor: UserRecord, entry: TalentPoolEntry, input: ReachOutInput) {
    assertStaff(actor);
    if (asPoolStatus(entry.get("status")) !== "active") {
      throw new ForbiddenError("This candidate is not in the talent pool.");
    }
    const text = input.text.trim();
    if (!text) {
      throw new ValidationError("The given data was invalid.", {
        text: ["The message field is required."],
      });
    }
    const subject = input.subject?.trim() || "Talent pool outreach";
    const candidate = await users.findByIdOrThrow(Number(entry.get("user_id")));
    const message = contactUserNotification(actor.email, candidate.email, subject, text);
    await notifyUser({ userId: candidate.id, ...message });
    await recordHiringEvent(
      "talent_pool.reached_out",
      {
        talent_pool_id: Number(entry.id),
        user_id: candidate.id,
        subject,
        created_by: actor.id,
      },
      { type: "talent_pool_entry", id: Number(entry.id) },
    );
    return { sent: true as const, user_id: candidate.id, subject };
  }
}

export const talentPoolService = new TalentPoolService();
