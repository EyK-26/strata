#!/usr/bin/env bun
/** Export parity catalog JSON for getstrata documentation CMS. */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PARITY_CATALOG, type ParityEntry } from "../scripts/parity-catalog.ts";

const SECTION_BY_PARITY: Record<string, string> = {
  "service-container": "architecture",
  "service-providers": "architecture",
  facades: "architecture",
  routing: "routing-http",
  middleware: "routing-http",
  csrf: "routing-http",
  controllers: "routing-http",
  "form-requests": "routing-http",
  validation: "routing-http",
  errors: "routing-http",
  etag: "routing-http",
  "rate-limiting": "routing-http",
  views: "views",
  "web-session": "views",
  database: "database",
  "query-builder": "database",
  migrations: "database",
  "schema-blueprint": "database",
  seeders: "database",
  factories: "database",
  transactions: "database",
  "chunk-cursor": "database",
  "eloquent-model": "orm",
  "eloquent-relationships": "orm",
  "eloquent-soft-deletes": "orm",
  "morph-relations": "orm",
  authentication: "auth",
  authorization: "auth",
  "route-model-binding": "auth",
  queues: "async",
  "failed-jobs": "async",
  scheduler: "async",
  events: "async",
  cache: "cache-storage",
  "file-storage": "cache-storage",
  mail: "mail-notifications",
  "mail-markdown": "mail-notifications",
  notifications: "mail-notifications",
  metrics: "observability",
  "graceful-shutdown": "observability",
  "stripe-webhooks": "integrations",
  horizon: "integrations",
  nova: "integrations",
  pagination: "api",
  "api-resources": "api",
  cli: "getting-started",
};

function strataTitle(entry: ParityEntry): string {
  return entry.laravelSection
    .replace(/^Eloquent: /, "")
    .replace(/^Horizon /, "Queue dashboard (")
    .replace(/^Nova /, "Admin resources (");
}

const exported = PARITY_CATALOG.map((entry) => ({
  id: entry.id,
  title: strataTitle(entry),
  sectionSlug: SECTION_BY_PARITY[entry.id] ?? "architecture",
  tier: entry.tier,
  strataApis: entry.strataApis,
  bootstrapApis: entry.bootstrapApis ?? [],
  notes: entry.notes ?? "",
}));

const cliEntry = {
  id: "cli",
  title: "Command line interface",
  sectionSlug: "getting-started",
  tier: "core" as const,
  strataApis: [],
  bootstrapApis: ["scheduleRunCommand"],
  notes: "@getstrata/cli — migrate, queue:work, make:* generators",
};

const output = [...exported.filter((e) => e.id !== "cli"), cliEntry];

const root = join(import.meta.dir, "..");
const targets = [
  join(root, "docs/parity-catalog.json"),
  join(root, "../getstrata/data/parity-catalog.json"),
];

for (const target of targets) {
  await writeFile(target, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(`Wrote ${target} (${output.length} entries)`);
}
