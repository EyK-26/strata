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
import { positions } from "../positions/repository.ts";
import type { UserRecord } from "../users/table.ts";
import { careerPostings } from "./repository.ts";
import type { CareerPostingRecord, CareerPostingStatus } from "./table.ts";

function asPostingStatus(value: unknown): CareerPostingStatus {
  if (value === "published" || value === "unpublished") {
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

export function serializeCareerPosting(row: CareerPosting | CareerPostingRecord) {
  const record =
    typeof (row as CareerPosting).toObject === "function"
      ? (row as CareerPosting).toObject()
      : (row as CareerPostingRecord);
  return {
    id: Number(record.id),
    position_id: Number(record.position_id),
    published_by: Number(record.published_by),
    status: asPostingStatus(record.status),
    created_at: iso(record.created_at),
    updated_at: iso(record.updated_at),
  };
}

export class CareerService {
  async forPosition(actor: UserRecord, position: Position) {
    assertStaff(actor);
    const row = await careerPostings.forPosition(Number(position.id));
    return row ? serializeCareerPosting(row) : null;
  }

  async listPublic() {
    const rows = await careerPostings.published();
    const listed = [];
    for (const row of rows) {
      const position = await positions.findById(row.position_id);
      if (!position || !isHiring(position)) {
        continue;
      }
      listed.push({
        ...serializeCareerPosting(row),
        name: position.name,
        description: position.description,
      });
    }
    return listed;
  }

  async showPublic(posting: CareerPosting) {
    if (asPostingStatus(posting.get("status")) !== "published") {
      throw new NotFoundError("Career posting not found.");
    }
    const position = await positions.findById(Number(posting.get("position_id")));
    if (!position || !isHiring(position)) {
      throw new NotFoundError("Career posting not found.");
    }
    return {
      ...serializeCareerPosting(posting),
      name: position.name,
      description: position.description,
    };
  }

  async publish(actor: UserRecord, position: Position) {
    assertStaff(actor);
    if (!isHiring({ hiring: position.get("hiring") as boolean | number | null })) {
      throw new UnprocessableEntityError("Only an open hiring seat can be published.");
    }
    const existing = await careerPostings.forPosition(Number(position.id));
    if (existing && asPostingStatus(existing.status) === "published") {
      throw new ConflictError("This position is already published to careers.");
    }
    const saved = existing
      ? await careerPostings.updateByIdOrThrow(existing.id, {
          published_by: actor.id,
          status: "published",
        })
      : await careerPostings.create({
          position_id: Number(position.id),
          published_by: actor.id,
          tenant_id: currentTenantId(),
          status: "published",
        });
    await recordHiringEvent(
      "career.published",
      { career_posting_id: saved.id, position_id: saved.position_id, published_by: actor.id },
      { type: "career_posting", id: saved.id },
    );
    return saved;
  }

  async unpublish(actor: UserRecord, posting: CareerPosting) {
    assertStaff(actor);
    if (asPostingStatus(posting.get("status")) !== "published") {
      throw new ForbiddenError("This career posting is not published.");
    }
    const updated = await careerPostings.updateByIdOrThrow(Number(posting.id), {
      status: "unpublished",
    });
    await recordHiringEvent(
      "career.unpublished",
      { career_posting_id: updated.id, position_id: updated.position_id },
      { type: "career_posting", id: updated.id },
    );
    return updated;
  }
}

export const careerService = new CareerService();
