/**
 * WorkHub — complex reference domain for framework stress-testing.
 *
 * Replaces character/nemesis/secret over time. Module layout:
 *
 *   organization/  top-level tenant (CRUD, unique slug)
 *   project/       belongsTo organization (CRUD, status enum, composite unique name)
 *   task/          belongsTo project (CRUD, priority, status enum) — Phase 2
 *   comment/       belongsTo task (CRUD, nested create) — Phase 2
 *   report/        cross-module aggregations — Phase 2
 *
 * Relationship graph:
 *
 *   organization 1──* project 1──* task 1──* comment
 *
 * Edge cases this domain is meant to exercise:
 * - unique violations (organization.slug, project per-org name)
 * - FK violations (project.organization_id, task.project_id)
 * - enum/check constraints (project.status, task.priority)
 * - transactions (create project + default task atomically)
 * - belongsTo eager loading (project → organization)
 * - cache invalidation on writes
 * - PATCH partial updates without nulling omitted fields
 */

const ORGANIZATION_TABLE = "organization" as const;
const PROJECT_TABLE = "project" as const;
const TASK_TABLE = "task" as const;
const COMMENT_TABLE = "comment" as const;
const TASK_ATTACHMENT_TABLE = "task_attachment" as const;

const PROJECT_STATUSES = ["draft", "active", "archived"] as const;
const TASK_STATUSES = ["todo", "in_progress", "done"] as const;

type ProjectStatus = (typeof PROJECT_STATUSES)[number];
type TaskStatus = (typeof TASK_STATUSES)[number];

export type { ProjectStatus, TaskStatus };
export {
  COMMENT_TABLE,
  ORGANIZATION_TABLE,
  PROJECT_STATUSES,
  PROJECT_TABLE,
  TASK_ATTACHMENT_TABLE,
  TASK_STATUSES,
  TASK_TABLE,
};
