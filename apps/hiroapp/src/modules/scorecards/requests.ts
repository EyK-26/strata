import { ValidationError } from "@getstrata/core/errors/http";
import { FormRequest } from "@getstrata/core/http/formRequest";
import { expectObject } from "@getstrata/core/http/validation";

export class SubmitScorecardRequest extends FormRequest<{
  overall_score: number;
  recommendation: string;
  notes: string | null;
}> {
  protected parse(payload: unknown) {
    const body = expectObject(payload);
    const overall_score = Number(body.overall_score);
    const recommendation =
      typeof body.recommendation === "string" ? body.recommendation.trim() : "";
    if (!Number.isInteger(overall_score) || overall_score < 1 || overall_score > 5) {
      throw new ValidationError("The given data was invalid.", {
        overall_score: ["The score must be an integer from 1 to 5."],
      });
    }
    if (!recommendation) {
      throw new ValidationError("The given data was invalid.", {
        recommendation: ["The recommendation is required."],
      });
    }
    return {
      overall_score,
      recommendation,
      notes: typeof body.notes === "string" ? body.notes : null,
    };
  }
}
