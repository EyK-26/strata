import { ForbiddenError } from "@getstrata/core/errors/http";
import { recordHiringEvent } from "../../lib/hiringEvents.ts";
import { isStaff, ROLE } from "../../lib/roles.ts";
import type { Position } from "../../models/Position.ts";
import { User } from "../../models/User.ts";
import type { UserRecord } from "../users/table.ts";

export type UserSkillInput = {
  skill_id: number;
  years?: number;
  level?: string;
};

export type PositionSkillInput = {
  skill_id: number;
  required?: boolean;
  weight?: number;
};

export type SkillMatchRow = {
  user: User;
  matched: number;
  required: number;
};

export function parseSkillIds(raw: unknown): number[] {
  return String(raw ?? "")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((id) => Number.isInteger(id) && id > 0);
}

function uniqueBySkillId<T extends { skill_id: number }>(items: T[]): T[] {
  const seen = new Set<number>();
  const out: T[] = [];
  for (const item of items) {
    const skillId = Number(item.skill_id);
    if (!Number.isInteger(skillId) || skillId <= 0 || seen.has(skillId)) {
      continue;
    }
    seen.add(skillId);
    out.push({ ...item, skill_id: skillId });
  }
  return out;
}

export class SkillService {
  async replaceUserSkills(user: UserRecord, items: UserSkillInput[]) {
    const model = User.newFromRecord(user);
    await model.skills().detach();
    for (const skill of uniqueBySkillId(items)) {
      await model
        .skills()
        .withPivotValues({
          years: Number(skill.years ?? 0),
          level: String(skill.level ?? "intermediate"),
        })
        .attach(skill.skill_id);
    }
    const rows = await model.skills();
    await recordHiringEvent(
      "user.skills_synced",
      { user_id: user.id, skill_ids: rows.map((row) => Number(row.id)) },
      { type: "user", id: user.id },
    );
    return rows;
  }

  async replacePositionSkills(actor: UserRecord, position: Position, items: PositionSkillInput[]) {
    if (!isStaff(actor.role_id)) {
      throw new ForbiddenError("Only staff can change position skills.");
    }
    await position.skills().detach();
    for (const skill of uniqueBySkillId(items)) {
      await position
        .skills()
        .withPivotValues({
          required: skill.required !== false,
          weight: Number(skill.weight ?? 1),
        })
        .attach(skill.skill_id);
    }
    const rows = await position.skills();
    await recordHiringEvent(
      "position.skills_synced",
      {
        position_id: Number(position.id),
        skill_ids: rows.map((row) => Number(row.id)),
        assigned_by: actor.id,
      },
      { type: "position", id: Number(position.id) },
    );
    return rows;
  }

  async matchCandidates(position: Position): Promise<SkillMatchRow[]> {
    const required = await position.skills();
    const requiredIds = [...new Set(required.map((skill) => Number(skill.id)))];
    const candidates = await User.where({ role_id: ROLE.CANDIDATE }).get();
    const matches: SkillMatchRow[] = [];
    for (const candidate of candidates) {
      const owned = await candidate.skills();
      const ownedIds = new Set(owned.map((skill) => Number(skill.id)));
      const hit = requiredIds.filter((skillId) => ownedIds.has(skillId)).length;
      matches.push({
        user: candidate,
        matched: hit,
        required: requiredIds.length,
      });
    }
    matches.sort(
      (left, right) => right.matched - left.matched || Number(left.user.id) - Number(right.user.id),
    );
    return matches;
  }

  presentMatch(row: SkillMatchRow) {
    return {
      id: row.user.id,
      first_name: row.user.get("first_name"),
      last_name: row.user.get("last_name"),
      matched: row.matched,
      required: row.required,
    };
  }

  presentMatchApi(row: SkillMatchRow) {
    return {
      user: row.user.toArray(),
      matched: row.matched,
      required: row.required,
    };
  }
}

export const skillService = new SkillService();
