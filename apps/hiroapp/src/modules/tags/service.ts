import {
  ConflictError,
  ForbiddenError,
  UnprocessableEntityError,
} from "@getstrata/core/errors/http";
import { currentTenantId } from "@getstrata/core/tenant/tenantContext";
import { recordHiringEvent } from "../../lib/hiringEvents.ts";
import { isCandidate, isStaff } from "../../lib/roles.ts";
import { iso } from "../../lib/serialize.ts";
import type { CandidateTag } from "../../models/CandidateTag.ts";
import type { User } from "../../models/User.ts";
import type { UserRecord } from "../users/table.ts";
import { candidateTags } from "./repository.ts";
import type { CandidateTagRecord } from "./table.ts";

export type CreateTagInput = {
  label: string;
};

function parseLabel(value: string) {
  const label = value.trim();
  if (!label) {
    throw new UnprocessableEntityError("A tag label is required.");
  }
  return label;
}

function assertStaff(actor: UserRecord) {
  if (!isStaff(actor.role_id)) {
    throw new ForbiddenError("Only staff can manage candidate tags.");
  }
}

async function assertCanView(actor: UserRecord, userId: number) {
  if (isStaff(actor.role_id)) {
    return;
  }
  if (Number(actor.id) !== Number(userId)) {
    throw new ForbiddenError("You cannot view these tags.");
  }
}

export function serializeTag(row: CandidateTag | CandidateTagRecord) {
  const record =
    typeof (row as CandidateTag).toObject === "function"
      ? (row as CandidateTag).toObject()
      : (row as CandidateTagRecord);
  return {
    id: Number(record.id),
    user_id: Number(record.user_id),
    created_by: Number(record.created_by),
    label: record.label,
    created_at: iso(record.created_at),
    updated_at: iso(record.updated_at),
  };
}

export class CandidateTagService {
  async listForUser(actor: UserRecord, user: User) {
    await assertCanView(actor, Number(user.id));
    const rows = await candidateTags.forUser(Number(user.id));
    return rows.map(serializeTag);
  }

  async add(actor: UserRecord, user: User, input: CreateTagInput) {
    assertStaff(actor);
    if (!isCandidate(user.get("role_id") as number)) {
      throw new UnprocessableEntityError("Only candidates can be tagged.");
    }
    const label = parseLabel(input.label);
    const existing = await candidateTags.findPair(Number(user.id), label);
    if (existing) {
      throw new ConflictError("This candidate already has that tag.");
    }
    const created = await candidateTags.create({
      user_id: Number(user.id),
      created_by: actor.id,
      tenant_id: currentTenantId(),
      label,
    });
    await recordHiringEvent(
      "candidate.tagged",
      { tag_id: created.id, user_id: created.user_id, label: created.label, created_by: actor.id },
      { type: "candidate_tag", id: created.id },
    );
    return created;
  }

  async remove(actor: UserRecord, tag: CandidateTag) {
    assertStaff(actor);
    const id = Number(tag.id);
    const userId = Number(tag.get("user_id"));
    const label = String(tag.get("label"));
    await candidateTags.deleteById(id);
    await recordHiringEvent(
      "candidate.untagged",
      { tag_id: id, user_id: userId, label },
      { type: "candidate_tag", id },
    );
    return { id, user_id: userId, label };
  }
}

export const tagService = new CandidateTagService();
