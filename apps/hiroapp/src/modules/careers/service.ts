import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnprocessableEntityError,
} from "@getstrata/core/errors/http";
import { currentTenantId } from "@getstrata/core/tenant/tenantContext";
import { recordHiringEvent } from "../../lib/hiringEvents.ts";
import { isStaff } from "../../lib/roles.ts";
import { hiringFlag, iso } from "../../lib/serialize.ts";
import type { CareerPosting } from "../../models/CareerPosting.ts";
import { Position } from "../../models/Position.ts";
import { departmentService } from "../departments/service.ts";
import { positions } from "../positions/repository.ts";
import { watchlistService } from "../positions/watchlist.ts";
import type { UserRecord } from "../users/table.ts";
import { careerPostings } from "./repository.ts";
import type { CareerPostingRecord, CareerPostingStatus } from "./table.ts";

export type PublishCareerInput = {
  expires_at?: string | null;
  publish_at?: string | null;
};

function asPostingStatus(value: unknown): CareerPostingStatus {
  if (
    value === "published" ||
    value === "unpublished" ||
    value === "expired" ||
    value === "scheduled"
  ) {
    return value;
  }
  return "unpublished";
}

function assertStaff(actor: UserRecord) {
  if (!isStaff(actor.role_id)) {
    throw new ForbiddenError("Only staff can publish career postings.");
  }
}

function isHiring(position: { hiring: boolean | number | string | null }) {
  return hiringFlag(position.hiring) === 1;
}

function asRecord(row: CareerPosting | CareerPostingRecord): CareerPostingRecord {
  return typeof (row as CareerPosting).toObject === "function"
    ? (row as CareerPosting).toObject()
    : (row as CareerPostingRecord);
}

function parseFutureDate(value: string | null | undefined, invalid: string, past: string) {
  const raw = value?.trim() ?? "";
  if (!raw) {
    return null;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new UnprocessableEntityError(invalid);
  }
  if (parsed.getTime() <= Date.now()) {
    throw new UnprocessableEntityError(past);
  }
  return parsed;
}

function parseExpiresAt(value: string | null | undefined) {
  return parseFutureDate(value, "The expiry date is invalid.", "The expiry must be in the future.");
}

function parsePublishAt(value: string | null | undefined) {
  return parseFutureDate(
    value,
    "The publish date is invalid.",
    "The publish time must be in the future.",
  );
}

function isLive(status: CareerPostingStatus) {
  return status === "published" || status === "scheduled";
}

export function serializeCareerPosting(row: CareerPosting | CareerPostingRecord) {
  const record = asRecord(row);
  return {
    id: Number(record.id),
    position_id: Number(record.position_id),
    published_by: Number(record.published_by),
    status: asPostingStatus(record.status),
    expires_at: iso(record.expires_at),
    publish_at: iso(record.publish_at),
    created_at: iso(record.created_at),
    updated_at: iso(record.updated_at),
  };
}

export class CareerService {
  private async publishIfDue(
    row: CareerPosting | CareerPostingRecord,
  ): Promise<CareerPostingRecord> {
    const record = asRecord(row);
    if (asPostingStatus(record.status) !== "scheduled") {
      return record;
    }
    if (record.publish_at) {
      const publishAt = new Date(record.publish_at);
      if (Number.isNaN(publishAt.getTime()) || publishAt.getTime() > Date.now()) {
        return record;
      }
    }
    const position = await positions.findById(record.position_id);
    if (!position || !isHiring(position)) {
      return record;
    }
    try {
      await departmentService.assertHiringOpen(Number(position.department_id));
    } catch {
      return record;
    }
    const updated = await careerPostings.updateByIdOrThrow(record.id, { status: "published" });
    await recordHiringEvent(
      "career.published",
      { career_posting_id: updated.id, position_id: updated.position_id },
      { type: "career_posting", id: updated.id },
    );
    await watchlistService.alertPublished(Position.newFromRecord(position), updated.id);
    return updated;
  }

  private async expireIfDue(
    row: CareerPosting | CareerPostingRecord,
  ): Promise<CareerPostingRecord> {
    const record = asRecord(row);
    if (asPostingStatus(record.status) !== "published") {
      return record;
    }
    if (!record.expires_at) {
      return record;
    }
    const expiresAt = new Date(record.expires_at);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() > Date.now()) {
      return record;
    }
    const updated = await careerPostings.updateByIdOrThrow(record.id, { status: "expired" });
    await recordHiringEvent(
      "career.expired",
      { career_posting_id: updated.id, position_id: updated.position_id },
      { type: "career_posting", id: updated.id },
    );
    return updated;
  }

  private async fresh(row: CareerPosting | CareerPostingRecord) {
    return this.expireIfDue(await this.publishIfDue(row));
  }

  async serializedForPosition(positionId: number) {
    const row = await careerPostings.forPosition(positionId);
    if (!row) {
      return null;
    }
    return serializeCareerPosting(await this.fresh(row));
  }

  async forPosition(actor: UserRecord, position: Position) {
    assertStaff(actor);
    return this.serializedForPosition(Number(position.id));
  }

  async listPublic() {
    const rows = await careerPostings.listed();
    const freshRows = await Promise.all(rows.map((row) => this.fresh(row)));
    const visible = await Promise.all(
      freshRows.map(async (fresh) => {
        if (asPostingStatus(fresh.status) !== "published") {
          return null;
        }
        const position = await positions.findById(fresh.position_id);
        if (!position || !isHiring(position)) {
          return null;
        }
        return {
          ...serializeCareerPosting(fresh),
          name: position.name,
          description: position.description,
        };
      }),
    );
    return visible.filter((row) => row !== null);
  }

  async showPublic(posting: CareerPosting) {
    const fresh = await this.fresh(posting);
    if (asPostingStatus(fresh.status) !== "published") {
      throw new NotFoundError("Career posting not found.");
    }
    const position = await positions.findById(Number(fresh.position_id));
    if (!position || !isHiring(position)) {
      throw new NotFoundError("Career posting not found.");
    }
    return {
      ...serializeCareerPosting(fresh),
      name: position.name,
      description: position.description,
    };
  }

  async publish(actor: UserRecord, position: Position, input: PublishCareerInput = {}) {
    assertStaff(actor);
    if (!isHiring({ hiring: position.get("hiring") as boolean | number | null })) {
      throw new UnprocessableEntityError("Only an open hiring seat can be published.");
    }
    await departmentService.assertHiringOpen(Number(position.get("department_id")));
    const publishAt = parsePublishAt(input.publish_at);
    const expiresAt = parseExpiresAt(input.expires_at);
    if (publishAt && expiresAt && expiresAt.getTime() <= publishAt.getTime()) {
      throw new UnprocessableEntityError("The expiry must be after the scheduled publish time.");
    }
    const existing = await careerPostings.forPosition(Number(position.id));
    const current = existing ? await this.fresh(existing) : null;
    if (current && isLive(asPostingStatus(current.status))) {
      throw new ConflictError("This position is already published to careers.");
    }
    const status: CareerPostingStatus = publishAt ? "scheduled" : "published";
    const saved = current
      ? await careerPostings.updateByIdOrThrow(current.id, {
          published_by: actor.id,
          status,
          expires_at: expiresAt,
          publish_at: publishAt,
        })
      : await careerPostings.create({
          position_id: Number(position.id),
          published_by: actor.id,
          tenant_id: currentTenantId(),
          status,
          expires_at: expiresAt,
          publish_at: publishAt,
        });
    await recordHiringEvent(
      publishAt ? "career.scheduled" : "career.published",
      { career_posting_id: saved.id, position_id: saved.position_id, published_by: actor.id },
      { type: "career_posting", id: saved.id },
    );
    if (!publishAt) {
      await watchlistService.alertPublished(position, saved.id);
    }
    return saved;
  }

  async unpublish(actor: UserRecord, posting: CareerPosting) {
    assertStaff(actor);
    const current = await this.fresh(posting);
    if (!isLive(asPostingStatus(current.status))) {
      throw new ForbiddenError("This career posting is not published.");
    }
    const updated = await careerPostings.updateByIdOrThrow(current.id, {
      status: "unpublished",
    });
    await recordHiringEvent(
      "career.unpublished",
      { career_posting_id: updated.id, position_id: updated.position_id },
      { type: "career_posting", id: updated.id },
    );
    return updated;
  }

  async expire(actor: UserRecord, posting: CareerPosting) {
    assertStaff(actor);
    const current = await this.fresh(posting);
    if (asPostingStatus(current.status) !== "published") {
      throw new ForbiddenError("This career posting cannot be expired.");
    }
    const updated = await careerPostings.updateByIdOrThrow(current.id, { status: "expired" });
    await recordHiringEvent(
      "career.expired",
      { career_posting_id: updated.id, position_id: updated.position_id },
      { type: "career_posting", id: updated.id },
    );
    return updated;
  }
}

export const careerService = new CareerService();
