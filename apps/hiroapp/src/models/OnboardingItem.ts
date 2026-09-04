import { Model, registerModelRepository } from "@getstrata/core/database/model";
import { onboardingItems } from "../modules/onboarding/repository.ts";
import type { OnboardingItemRecord } from "../modules/onboarding/table.ts";
import { Application } from "./Application.ts";
import { User } from "./User.ts";

export class OnboardingItem extends Model<OnboardingItemRecord, "id"> {
  static $fillable = [
    "application_id",
    "created_by",
    "completed_by",
    "title",
    "notes",
    "status",
    "completed_at",
    "tenant_id",
  ] as const;
  static $guarded = [] as const;
  static $morphClass = "App\\Models\\OnboardingItem";
  static $casts = {
    id: "integer",
    application_id: "integer",
    created_by: "integer",
    completed_by: "integer",
  } as const;

  application() {
    return this.belongsTo(() => Application);
  }

  creator() {
    return this.belongsTo(() => User, "created_by");
  }

  completer() {
    return this.belongsTo(() => User, "completed_by");
  }
}

registerModelRepository(OnboardingItem, onboardingItems);
