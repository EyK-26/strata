import { afterAll, describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { createGeneratedSourceApps } from "../helpers/generatedSourceApps";

const generated = createGeneratedSourceApps();
afterAll(generated.close);

const repoRoot = join(import.meta.dir, "../..");

async function listTsFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listTsFiles(path)));
      continue;
    }
    if (entry.name.endsWith(".ts")) {
      files.push(path);
    }
  }
  return files;
}

const unboundedNeedle = "runWithMigrationBypass(";

const allowedUnbounded = new Set([
  // CLI-only bootstrap administration; generated placement and HTTP isolation asserted below.
  join(repoRoot, "packages/strata-starter/src/renderInitialAdmin.ts"),
  join(generated.rls, "src/db/migrate.ts"),
  join(repoRoot, "src/db/migrations/runner.ts"),
  join(repoRoot, "src/db/seeders/runner.ts"),
  join(repoRoot, "src/core/audit/exportAuditLogs.ts"),
  // Worker-only coordination; publication is fenced to the business transaction below.
  join(repoRoot, "src/core/events/outbox/index.ts"),
  // Explicit authenticated platform observation: capped, read-only, deadline-bound.
  join(repoRoot, "src/core/events/outbox/metrics.ts"),
]);

const requestPathRoots = [
  join(generated.rls, "src/modules"),
  join(generated.rls, "src/bootstrap"),
  join(generated.team, "src/modules"),
  join(generated.team, "src/bootstrap"),
  join(repoRoot, "src/bootstrap"),
  join(repoRoot, "src/core"),
  join(repoRoot, "packages/strata-starter/src"),
];

const requiredRequestPathFiles = [
  join(generated.rls, "src/bootstrap/authDirectory.ts"),
  join(generated.team, "src/bootstrap/authDirectory.ts"),
  join(repoRoot, "src/bootstrap/web/session.ts"),
  join(repoRoot, "src/core/tenant/tenantMiddleware.ts"),
  join(repoRoot, "packages/strata-starter/src/renderAuth.ts"),
  join(repoRoot, "packages/strata-starter/src/renderAuthFlows.ts"),
  join(repoRoot, "packages/strata-starter/src/auth/renderingContext.ts"),
  join(repoRoot, "packages/strata-starter/src/auth/renderImports.ts"),
  join(repoRoot, "packages/strata-starter/src/auth/renderWorkflows.ts"),
  join(repoRoot, "packages/strata-starter/src/auth/renderApiRoutes.ts"),
  join(repoRoot, "packages/strata-starter/src/auth/renderBrowserRoutes.ts"),
  join(repoRoot, "packages/strata-starter/src/renderScim.ts"),
  join(repoRoot, "packages/strata-starter/src/renderRuntime.ts"),
  join(repoRoot, "packages/strata-starter/src/renderDatabase.ts"),
  join(repoRoot, "packages/strata-starter/src/renderMigrations.ts"),
  join(repoRoot, "packages/strata-starter/src/renderModels.ts"),
  join(repoRoot, "packages/strata-starter/src/renderBootstrap.ts"),
  join(repoRoot, "packages/strata-starter/src/renderCli.ts"),
];

describe("request-path RLS bypass fence", () => {
  test("request-path callers do not call unbounded runWithMigrationBypass(", async () => {
    const files: string[] = [];
    for (const root of requestPathRoots) {
      const scanned = await listTsFiles(root);
      expect(scanned.length, root).toBeGreaterThan(0);
      files.push(...scanned);
    }

    for (const file of requiredRequestPathFiles) {
      expect(files, file).toContain(file);
    }

    const offenders: string[] = [];
    for (const file of files) {
      if (allowedUnbounded.has(file)) {
        continue;
      }
      if (file === join(repoRoot, "packages/strata-starter/src/renderMigrations.ts")) {
        continue;
      }
      if (file === join(repoRoot, "packages/strata-starter/src/renderIntegrations.ts")) {
        continue;
      }
      const text = await readFile(file, "utf8");
      if (text.includes(unboundedNeedle)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("initial-admin global bypass is confined to the explicit operator command", async () => {
    const renderer = await readFile(
      join(repoRoot, "packages/strata-starter/src/renderInitialAdmin.ts"),
      "utf8",
    );
    expect([...renderer.matchAll(/runWithMigrationBypass\(/g)]).toHaveLength(1);
    expect(renderer).toContain("export async function initialAdminCommand");
    expect(renderer).toContain("await assertRlsLiveDatabaseRole()");
    expect(renderer).toContain("runInTransaction(async db");
    const generation = await readFile(
      join(repoRoot, "packages/strata-starter/src/generate.ts"),
      "utf8",
    );
    expect(generation).toContain(
      'writeText(join(src, "cli/initialAdmin.ts"), initialAdminCommand)',
    );
    for (const directory of [
      join(generated.rls, "src/modules"),
      join(generated.team, "src/modules"),
      join(repoRoot, "src/bootstrap"),
    ]) {
      for (const file of await listTsFiles(directory)) {
        const text = await readFile(file, "utf8");
        expect(text, file).not.toContain("initialAdminCommand");
        expect(text, file).not.toContain("cli/initialAdmin");
      }
    }
  });

  test("outbox publication never bypasses RLS and coordination rejects an active business transaction", async () => {
    const text = await readFile(join(repoRoot, "src/core/events/outbox/index.ts"), "utf8");
    const publish = text.slice(
      text.indexOf("  async publish("),
      text.indexOf("  private async claim("),
    );
    expect(publish).not.toContain(unboundedNeedle);
    expect(publish).not.toContain("privileged(");
    expect(publish).toContain("hasActiveTransaction()");
    const coordination = text.slice(
      text.indexOf("async function privileged"),
      text.indexOf("class SqlOutbox"),
    );
    expect(coordination).toContain("if (hasActiveTransaction())");
    expect(coordination.indexOf("if (hasActiveTransaction())")).toBeLessThan(
      coordination.indexOf(unboundedNeedle),
    );
  });

  test("generated runtime unbounded bypass sits in migrate/seed, not request handlers", async () => {
    const file = join(repoRoot, "packages/strata-starter/src/renderMigrations.ts");
    const text = await readFile(file, "utf8");
    const matches = [...text.matchAll(/runWithMigrationBypass\(/g)];
    expect(matches).toHaveLength(1);

    const migrateStart = text.indexOf("function renderMigrateTs");
    const migrateEnd = text.indexOf("function dropTables");
    expect(migrateStart).toBeGreaterThan(-1);
    expect(migrateEnd).toBeGreaterThan(migrateStart);
    const migrateSlice = text.slice(migrateStart, migrateEnd);
    expect(migrateSlice).toContain(unboundedNeedle);
    expect(migrateSlice).toContain("export async function seed()");
    expect(migrateSlice).toContain(`\${seedOpen}`);

    const bootstrap = await readFile(
      join(repoRoot, "packages/strata-starter/src/renderBootstrap.ts"),
      "utf8",
    );
    expect(bootstrap).not.toContain(unboundedNeedle);
    const createAppStart = bootstrap.indexOf("function renderCreateAppTs");
    const createAppEnd = bootstrap.indexOf("function renderRoutesTs");
    expect(createAppStart).toBeGreaterThan(-1);
    expect(createAppEnd).toBeGreaterThan(createAppStart);
    expect(bootstrap.slice(createAppStart, createAppEnd)).not.toContain(unboundedNeedle);
  });

  test("generated webhook job bypass is the delivery insert, not the billing route", async () => {
    const file = join(repoRoot, "packages/strata-starter/src/renderIntegrations.ts");
    const text = await readFile(file, "utf8");
    const jobStart = text.indexOf("function renderDispatchOutboundWebhookJob");
    const jobEnd = text.indexOf("function renderNoteCreatedWebhookListener");
    const billingStart = text.indexOf("function renderBillingModule");
    expect(jobStart).toBeGreaterThan(-1);
    expect(jobEnd).toBeGreaterThan(jobStart);
    expect(billingStart).toBeGreaterThan(jobEnd);
    expect(text.slice(jobStart, jobEnd)).toContain(unboundedNeedle);
    expect(text.slice(billingStart)).not.toContain(unboundedNeedle);
  });
});

test("outbox metrics bypass is confined to bounded read-only platform observation", async () => {
  const collector = await readFile(join(repoRoot, "src/core/events/outbox/metrics.ts"), "utf8");
  expect([...collector.matchAll(/runWithMigrationBypass\(/g)]).toHaveLength(1);
  const lifecycle = await readFile(
    join(repoRoot, "src/core/database/readOnlyCollector.ts"),
    "utf8",
  );
  expect(collector).toContain("createReadOnlyCollector(");
  expect(lifecycle).toContain("hasActiveTransaction()");
  expect(lifecycle).toContain("SET TRANSACTION READ ONLY");
  expect(lifecycle).toContain("statement_timeout");
  expect(lifecycle).toContain("acquisitionSignal: acquisition.signal");
  expect(lifecycle).not.toContain("runWithMigrationBypass(");
  expect(collector).toContain("LIMIT $1");
  expect(collector).not.toContain("SELECT payload");
  const routes = await readFile(join(repoRoot, "src/bootstrap/metricsRoutes.ts"), "utf8");
  expect(routes.indexOf("if (!authorizeMetrics(request))")).toBeLessThan(
    routes.indexOf("(await collect())"),
  );
  expect(routes).toMatch(
    /!options\.queue\s*&&\s*!options\.outbox\s*&&\s*!options\.tracing\s*&&\s*!options\.transactionAcquisition\s*&&\s*!options\.failedJobs/,
  );
});

test("failed-job observation uses a bounded ID projection without an RLS bypass", async () => {
  const collector = await readFile(join(repoRoot, "src/core/queue/failedJobMetrics.ts"), "utf8");
  expect(collector).toContain("createReadOnlyCollector(");
  expect(collector).toContain('.project(["id"], sampleLimit + 1)');
  expect(collector).toContain("NOT c.relrowsecurity");
  expect(collector).toContain("i.indisprimary");
  expect(collector).not.toContain(unboundedNeedle);
  expect(collector).not.toContain("listRecent(");
  expect(collector).not.toContain('project(["payload"');
});
