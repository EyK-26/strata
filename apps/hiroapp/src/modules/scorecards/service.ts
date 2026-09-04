import { ForbiddenError, UnprocessableEntityError } from "@getstrata/core/errors/http";
import { currentTenantId } from "@getstrata/core/tenant/tenantContext";
import { recordHiringEvent } from "../../lib/hiringEvents.ts";
import { isStaff } from "../../lib/roles.ts";
import { iso } from "../../lib/serialize.ts";
import type { Interview } from "../../models/Interview.ts";
import type { UserRecord } from "../users/table.ts";
import { scorecards } from "./repository.ts";
import type { ScorecardRecommendation, ScorecardRecord } from "./table.ts";

export type ScorecardInput = {
  overall_score: number;
  recommendation: string;
  notes?: string | null;
};

function assertStaff(actor: UserRecord) {
  if (!isStaff(actor.role_id)) {
    throw new ForbiddenError("Only staff can manage interview scorecards.");
  }
}

function parseRecommendation(value: string): ScorecardRecommendation {
  if (value === "hire" || value === "no_hire" || value === "hold") {
    return value;
  }
  throw new UnprocessableEntityError("Recommendation must be hire, no_hire, or hold.");
}

function parseScore(value: number) {
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new UnprocessableEntityError("Score must be an integer from 1 to 5.");
  }
  return value;
}

export function serializeScorecard(row: ScorecardRecord) {
  return {
    id: Number(row.id),
    interview_id: Number(row.interview_id),
    user_id: Number(row.user_id),
    overall_score: Number(row.overall_score),
    recommendation: row.recommendation,
    notes: row.notes,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}

export function summarizeScorecards(rows: ScorecardRecord[]) {
  const hire = rows.filter((row) => row.recommendation === "hire").length;
  const noHire = rows.filter((row) => row.recommendation === "no_hire").length;
  const hold = rows.filter((row) => row.recommendation === "hold").length;
  const total = rows.reduce((sum, row) => sum + Number(row.overall_score), 0);
  return {
    count: rows.length,
    average: rows.length === 0 ? null : total / rows.length,
    hire,
    no_hire: noHire,
    hold,
  };
}

export class ScorecardService {
  async listForInterview(actor: UserRecord, interview: Interview) {
    assertStaff(actor);
    const rows = await scorecards.forInterview(Number(interview.id));
    return { data: rows.map(serializeScorecard), summary: summarizeScorecards(rows) };
  }

  async submit(actor: UserRecord, interview: Interview, input: ScorecardInput) {
    assertStaff(actor);
    const overallScore = parseScore(Number(input.overall_score));
    const recommendation = parseRecommendation(String(input.recommendation ?? "").trim());
    const notes = input.notes?.trim() || null;
    const existing = await scorecards.findPair(Number(interview.id), actor.id);
    const saved = existing
      ? await scorecards.updateByIdOrThrow(existing.id, {
          overall_score: overallScore,
          recommendation,
          notes,
        })
      : await scorecards.create({
          interview_id: Number(interview.id),
          user_id: actor.id,
          tenant_id: currentTenantId(),
          overall_score: overallScore,
          recommendation,
          notes,
        });
    await recordHiringEvent(
      existing ? "interview.scorecard_updated" : "interview.scorecard_submitted",
      {
        interview_id: Number(interview.id),
        scorecard_id: saved.id,
        user_id: actor.id,
        overall_score: overallScore,
        recommendation,
      },
      { type: "interview", id: Number(interview.id) },
    );
    return saved;
  }
}

export const scorecardService = new ScorecardService();
