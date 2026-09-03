import { Factory } from "@getstrata/core/database/factory";
import ProjectRepository from "./repository";
import type { ProjectRecord } from "./types";

class ProjectFactory extends Factory<ProjectRecord> {
  protected override definition(): ProjectRecord {
    const now = new Date();

    return {
      id: 0,
      organization_id: 1,
      tenant_id: 1,
      name: `Factory Project ${crypto.randomUUID().slice(0, 8)}`,
      status: "active",
      created_at: now,
      updated_at: now,
      deleted_at: null,
    };
  }

  protected override persist(values: Partial<ProjectRecord>): Promise<ProjectRecord> {
    return new ProjectRepository().create(values);
  }
}

const projectFactory = new ProjectFactory();

export { ProjectFactory, projectFactory };
