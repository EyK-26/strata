import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

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
  join(repoRoot, "apps/hiroapp/src/db/migrate.ts"),
  join(repoRoot, "src/db/migrations/runner.ts"),
  join(repoRoot, "src/db/seeders/runner.ts"),
  join(repoRoot, "src/core/audit/exportAuditLogs.ts"),
]);

const requestPathRoots = [
  join(repoRoot, "apps/hiroapp/src/modules"),
  join(repoRoot, "apps/hiroapp/src/bootstrap"),
  join(repoRoot, "apps/hiroapp-team/src/modules"),
  join(repoRoot, "apps/hiroapp-team/src/bootstrap"),
  join(repoRoot, "src/bootstrap"),
  join(repoRoot, "src/core"),
  join(repoRoot, "packages/strata-starter/src"),
];

const requiredRequestPathFiles = [
  join(repoRoot, "apps/hiroapp/src/bootstrap/authDirectory.ts"),
  join(repoRoot, "apps/hiroapp-team/src/bootstrap/authDirectory.ts"),
  join(repoRoot, "src/bootstrap/web/session.ts"),
  join(repoRoot, "src/core/tenant/tenantMiddleware.ts"),
  join(repoRoot, "packages/strata-starter/src/renderAuth.ts"),
  join(repoRoot, "packages/strata-starter/src/renderAuthFlows.ts"),
  join(repoRoot, "packages/strata-starter/src/renderScim.ts"),
  join(repoRoot, "packages/strata-starter/src/renderRuntime.ts"),
];

describe("request-path RLS bypass fence", () => {
  test("request-path callers do not call unbounded runWithMigrationBypass(", async () => {
    const files: string[] = [];
    for (const root of requestPathRoots) {
      files.push(...(await listTsFiles(root)));
    }

    for (const file of requiredRequestPathFiles) {
      expect(files, file).toContain(file);
    }

    const offenders: string[] = [];
    for (const file of files) {
      if (allowedUnbounded.has(file)) {
        continue;
      }
      if (file === join(repoRoot, "packages/strata-starter/src/renderRuntime.ts")) {
        continue;
      }
      const text = await readFile(file, "utf8");
      if (text.includes(unboundedNeedle)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("generated renderRuntime unbounded bypass sits in migrate/seed, not request handlers", async () => {
    const file = join(repoRoot, "packages/strata-starter/src/renderRuntime.ts");
    const text = await readFile(file, "utf8");
    const matches = [...text.matchAll(/runWithMigrationBypass\(/g)];
    expect(matches).toHaveLength(1);

    const migrateStart = text.indexOf("function renderMigrateTs");
    const migrateEnd = text.indexOf("function renderNoteModel");
    expect(migrateStart).toBeGreaterThan(-1);
    expect(migrateEnd).toBeGreaterThan(migrateStart);
    const migrateSlice = text.slice(migrateStart, migrateEnd);
    expect(migrateSlice).toContain(unboundedNeedle);
    expect(migrateSlice).toContain("export async function seed()");
    expect(migrateSlice).toContain(`\${seedOpen}`);

    const createAppStart = text.indexOf("function renderCreateAppTs");
    const createAppEnd = text.indexOf("function renderRoutesTs");
    expect(createAppStart).toBeGreaterThan(-1);
    expect(createAppEnd).toBeGreaterThan(createAppStart);
    expect(text.slice(createAppStart, createAppEnd)).not.toContain(unboundedNeedle);
  });
});
