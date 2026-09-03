import { Factory } from "@getstrata/core/database/factory";
import TaskRepository from "./repository";
import type { TaskRecord } from "./types";

class TaskFactory extends Factory<TaskRecord> {
  protected override definition(): TaskRecord {
    const now = new Date();

    return {
      id: 0,
      project_id: 1,
      tenant_id: 1,
      title: "Factory Task",
      status: "todo",
      priority: 1,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    };
  }

  protected override persist(values: Partial<TaskRecord>): Promise<TaskRecord> {
    return new TaskRepository().create(values);
  }
}

const taskFactory = new TaskFactory();

export { TaskFactory, taskFactory };
