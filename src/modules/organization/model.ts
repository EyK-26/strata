import { Model, registerModelRepository } from "@getstrata/core/database/model";
import OrganizationRepository from "./repository";
import type { OrganizationRecord } from "./types";

class OrganizationModelClass extends Model<OrganizationRecord, "id"> {
  static override $fillable = ["tenant_id", "name", "slug"] as const;
  static override $casts = {
    created_at: "datetime",
    updated_at: "datetime",
    deleted_at: "datetime",
  } as const;

  protected override primaryKey(): "id" {
    return "id";
  }

  projects() {
    const { ProjectModel } = require("../project/model.ts") as typeof import("../project/model.ts");
    return this.hasMany(ProjectModel);
  }
}

const organizationRepository = new OrganizationRepository();

export const OrganizationModel = registerModelRepository(
  OrganizationModelClass,
  organizationRepository,
);

export { organizationRepository };
