import { ValidationError } from "@getstrata/core/errors/http";
import { FormRequest } from "@getstrata/core/http/formRequest";
import { expectObject } from "@getstrata/core/http/validation";

export class SyncUserSkillsRequest extends FormRequest<{
  skills: Array<{ skill_id: number; years: number; level: string }>;
}> {
  protected parse(payload: unknown) {
    const body = expectObject(payload);
    const raw = Array.isArray(body.skills) ? body.skills : [];
    const skills = raw.map((item) => {
      const row = expectObject(item, "skill");
      const skill_id = Number(row.skill_id);
      if (!Number.isInteger(skill_id) || skill_id <= 0) {
        throw new ValidationError("The given data was invalid.", {
          skill_id: ["The skill is required."],
        });
      }
      return {
        skill_id,
        years: Number(row.years ?? 0),
        level: String(row.level ?? "intermediate"),
      };
    });
    return { skills };
  }
}

export class SyncPositionSkillsRequest extends FormRequest<{
  skills: Array<{ skill_id: number; required: boolean; weight: number }>;
}> {
  protected parse(payload: unknown) {
    const body = expectObject(payload);
    const raw = Array.isArray(body.skills) ? body.skills : [];
    return {
      skills: raw.map((item) => {
        const row = expectObject(item, "skill");
        return {
          skill_id: Number(row.skill_id),
          required: row.required === true || row.required === 1 || row.required === "1",
          weight: Number(row.weight ?? 1),
        };
      }),
    };
  }
}

export class CreateCommentRequest extends FormRequest<{ body: string }> {
  protected parse(payload: unknown) {
    const body = expectObject(payload);
    const text = String(body.body ?? "").trim();
    if (text.length === 0) {
      throw new ValidationError("The given data was invalid.", {
        body: ["The comment is required."],
      });
    }
    return { body: text };
  }
}

export class InterviewersRequest extends FormRequest<{
  user_ids: number[];
  role: string;
}> {
  protected parse(payload: unknown) {
    const body = expectObject(payload);
    const ids = Array.isArray(body.user_ids) ? body.user_ids.map(Number) : [Number(body.user_id)];
    return {
      user_ids: ids.filter((id) => Number.isInteger(id) && id > 0),
      role: String(body.role ?? "panel"),
    };
  }
}
