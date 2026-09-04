import { ForbiddenError, UnprocessableEntityError } from "@getstrata/core/errors/http";
import { currentTenantId } from "@getstrata/core/tenant/tenantContext";
import { recordHiringEvent } from "../../lib/hiringEvents.ts";
import { isCandidate, isStaff } from "../../lib/roles.ts";
import { iso } from "../../lib/serialize.ts";
import type { CandidateMerge } from "../../models/CandidateMerge.ts";
import { applications } from "../applications/repository.ts";
import { talentPool } from "../pool/repository.ts";
import { users } from "../users/repository.ts";
import type { UserRecord } from "../users/table.ts";
import { candidateMerges } from "./repository.ts";
import type { CandidateMergeRecord, PoolMergeAction } from "./table.ts";

export type MergeInput = {
  source_id: number;
  target_id: number;
};

function asPoolAction(value: unknown): PoolMergeAction {
  if (
    value === "retargeted" ||
    value === "released_source" ||
    value === "kept_target" ||
    value === "unchanged"
  ) {
    return value;
  }
  return "unchanged";
}

function assertStaff(actor: UserRecord) {
  if (!isStaff(actor.role_id)) {
    throw new ForbiddenError("Only staff can merge candidate profiles.");
  }
}

async function moveApplications(sourceId: number, targetId: number) {
  const rows = await applications.forUser(sourceId);
  const moved: number[] = [];
  const skipped: number[] = [];
  for (const row of rows) {
    const existing = await applications.findPair(targetId, Number(row.position_id));
    if (existing) {
      skipped.push(row.id);
      continue;
    }
    await applications.updateByIdOrThrow(row.id, { user_id: targetId });
    moved.push(row.id);
  }
  return { moved, skipped };
}

async function mergeTalentPool(sourceId: number, targetId: number): Promise<PoolMergeAction> {
  const sourceEntry = await talentPool.findByUser(sourceId);
  const targetEntry = await talentPool.findByUser(targetId);
  if (sourceEntry && !targetEntry) {
    await talentPool.updateByIdOrThrow(sourceEntry.id, { user_id: targetId });
    return "retargeted";
  }
  if (sourceEntry && targetEntry) {
    if (sourceEntry.status === "active") {
      await talentPool.updateByIdOrThrow(sourceEntry.id, { status: "released" });
      return "released_source";
    }
    return "kept_target";
  }
  return "unchanged";
}

export function serializeMerge(row: CandidateMerge | CandidateMergeRecord) {
  const record =
    typeof (row as CandidateMerge).toObject === "function"
      ? (row as CandidateMerge).toObject()
      : (row as CandidateMergeRecord);
  return {
    id: Number(record.id),
    source_user_id: Number(record.source_user_id),
    target_user_id: Number(record.target_user_id),
    merged_by: Number(record.merged_by),
    applications_moved: Number(record.applications_moved),
    applications_skipped: Number(record.applications_skipped),
    pool_action: asPoolAction(record.pool_action),
    created_at: iso(record.created_at),
    updated_at: iso(record.updated_at),
  };
}

export class CandidateMergeService {
  async list(actor: UserRecord) {
    assertStaff(actor);
    const rows = await candidateMerges.recent();
    return rows.map(serializeMerge);
  }

  async merge(actor: UserRecord, input: MergeInput) {
    assertStaff(actor);
    const sourceId = Number(input.source_id);
    const targetId = Number(input.target_id);
    if (
      !Number.isInteger(sourceId) ||
      sourceId <= 0 ||
      !Number.isInteger(targetId) ||
      targetId <= 0 ||
      sourceId === targetId
    ) {
      throw new UnprocessableEntityError("Choose two different candidate profiles.");
    }
    const source = await users.findById(sourceId);
    if (!source) {
      throw new UnprocessableEntityError("Unknown source candidate.");
    }
    const target = await users.findById(targetId);
    if (!target) {
      throw new UnprocessableEntityError("Unknown target candidate.");
    }
    if (!isCandidate(source.role_id) || !isCandidate(target.role_id)) {
      throw new UnprocessableEntityError("Only candidate profiles can be merged.");
    }
    const { moved, skipped } = await moveApplications(sourceId, targetId);
    const poolAction = await mergeTalentPool(sourceId, targetId);
    const saved = await candidateMerges.create({
      source_user_id: sourceId,
      target_user_id: targetId,
      merged_by: actor.id,
      tenant_id: currentTenantId(),
      applications_moved: moved.length,
      applications_skipped: skipped.length,
      pool_action: poolAction,
    });
    await recordHiringEvent(
      "candidate.merged",
      {
        merge_id: saved.id,
        source_user_id: sourceId,
        target_user_id: targetId,
        merged_by: actor.id,
        applications_moved: moved.length,
        applications_skipped: skipped.length,
        moved_application_ids: moved,
        skipped_application_ids: skipped,
        pool_action: poolAction,
      },
      { type: "candidate_merge", id: saved.id },
    );
    return saved;
  }
}

export const mergeService = new CandidateMergeService();
