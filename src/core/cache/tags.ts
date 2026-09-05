const CACHE_TAGS = {
  organizations: "organizations",
  projects: "projects",
  tasks: "tasks",
  comments: "comments",
  attachments: "attachments",
  reports: "reports",
  users: "users",
  departments: "departments",
  positions: "positions",
  applications: "applications",
  careers: "careers",
  offers: "offers",
} as const;

type CacheTag = (typeof CACHE_TAGS)[keyof typeof CACHE_TAGS];

export type { CacheTag };
export { CACHE_TAGS };
