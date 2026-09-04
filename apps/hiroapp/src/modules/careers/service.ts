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
import type { Position } from "../../models/Position.ts";
import { departmentService } from "../departments/service.ts";
import { positions } from "../positions/repository.ts";
import { watchlistService } from "../positions/watchlist.ts";
import type { UserRecord } from "../users/table.ts";
import { careerPostings } from "./repository.ts";
import type { CareerPostingRecord, CareerPostingStatus } from "./table.ts";

function asPostingStatus(value: unknown): CareerPostingStatus {
  if (value === "published" || value === "unpublished" || value === "expired") {
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

function parseExpiresAt(value: string | null | undefined) {
  const raw = value?.trim() ?? "";
  if (!raw) {
    return null;
  }
  const expiresAt = new Date(raw);
  if (Number.isNaN(expiresAt.getTime())) {
    throw new UnprocessableEntityError("The expiry date is invalid.");
  }
  if (expiresAt.getTime() <= Date.now()) {
    throw new UnprocessableEntityError("The expiry must be in the future.");
  }
  return expiresAt;
}

export function serializeCareerPosting(row: CareerPosting | CareerPostingRecord) {
  const record = asRecord(row);
  return {
    id: Number(record.id),
    position_id: Number(record.position_id),
    published_by: Number(record.published_by),
    status: asPostingStatus(record.status),
    expires_at: iso(record.expires_at),
    created_at: iso(record.created_at),
    updated_at: iso(record.updated_at),
  };
}

export class CareerService {
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

  async serializedForPosition(positionId: number) {
    const row = await careerPostings.forPosition(positionId);
    if (!row) {
      return null;
    }
    return serializeCareerPosting(await this.expireIfDue(row));
  }

  async forPosition(actor: UserRecord, position: Position) {
    assertStaff(actor);
    return this.serializedForPosition(Number(position.id));
  }

  async listPublic() {
    const rows = await careerPostings.published();
    const listed = [];
    for (const row of rows) {
      const fresh = await this.expireIfDue(row);
      if (asPostingStatus(fresh.status) !== "published") {
        continue;
      }
      const position = await positions.findById(fresh.position_id);
      if (!position || !isHiring(position)) {
        continue;
      }
      listed.push({
        ...serializeCareerPosting(fresh),
        name: position.name,
        description: position.description,
      });
    }
    return listed;
  }

  async showPublic(posting: CareerPosting) {
    const fresh = await this.expireIfDue(posting);
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

  async publish(actor: UserRecord, position: Position, input: { expires_at?: string | null } = {}) {
    assertStaff(actor);
    if (!isHiring({ hiring: position.get("hiring") as boolean | number | null })) {
      throw new UnprocessableEntityError("Only an open hiring seat can be published.");
    }
    await departmentService.assertHiringOpen(Number(position.get("department_id")));
    const expiresAt = parseExpiresAt(input.expires_at);
    const existing = await careerPostings.forPosition(Number(position.id));
    const current = existing ? await this.expireIfDue(existing) : null;
    if (current && asPostingStatus(current.status) === "published") {
      throw new ConflictError("This position is already published to careers.");
    }
    const saved = current
      ? await careerPostings.updateByIdOrThrow(current.id, {
          published_by: actor.id,
          status: "published",
          expires_at: expiresAt,
        })
      : await careerPostings.create({
          position_id: Number(position.id),
          published_by: actor.id,
          tenant_id: currentTenantId(),
          status: "published",
          expires_at: expiresAt,
        });
    await recordHiringEvent(
      "career.published",
      { career_posting_id: saved.id, position_id: saved.position_id, published_by: actor.id },
      { type: "career_posting", id: saved.id },
    );
    await watchlistService.alertPublished(position, saved.id);
    return saved;
  }

  async unpublish(actor: UserRecord, posting: CareerPosting) {
    assertStaff(actor);
    const current = await this.expireIfDue(posting);
    if (asPostingStatus(current.status) !== "published") {
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
    const current = await this.expireIfDue(posting);
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
