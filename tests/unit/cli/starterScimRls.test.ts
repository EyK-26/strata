import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetDiscoverModulesForTests } from "@getstrata/bootstrap/discoverModules";
import { hashPassword } from "@getstrata/core/auth/password";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { resetBoundDatabaseConnection } from "@getstrata/core/database/boundConnection";
import { resetDefaultDatabasePoolForTests } from "@getstrata/core/database/defaultConnection";
import { resetSqlDialect } from "@getstrata/core/database/dialect";
import { defineTable } from "@getstrata/core/database/table";
import { runWithMigrationBypass } from "@getstrata/core/tenant/databaseTenantContext";
import { SQL } from "bun";
import {
  generateProject,
  resolveOverlayRoot,
  resolveTemplateRoot,
} from "../../../packages/strata-starter/src/generate.ts";
import {
  layersFromFlags,
  parseCreateStrataArgs,
} from "../../../packages/strata-starter/src/parseArgs.ts";
import { installGeneratedAppDependencies, repoRoot } from "./helpers";

const original = { ...process.env };
afterEach(() => {
  process.chdir(repoRoot);
  for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
  Object.assign(process.env, original);
  resetSqlDialect();
  resetBoundDatabaseConnection();
  resetDefaultDatabasePoolForTests();
  resetDiscoverModulesForTests();
});

test("generated SCIM mutation rejection and observer rollback preserve restricted Postgres tenant isolation", async () => {
  const adminSource = original.MIGRATION_DATABASE_URL;
  const runtimeSource = original.RLS_TEST_DATABASE_URL ?? original.APP_DATABASE_URL;
  if (!adminSource || !runtimeSource) throw new Error("Dedicated Postgres roles required.");
  const root = await mkdtemp(join(tmpdir(), "strata-scim-rls-"));
  const name = `scim_${crypto.randomUUID().replaceAll("-", "")}`;
  const control = new SQL(adminSource);
  let created = false;
  let closeApp = async () => {};
  try {
    const app = join(root, "app");
    const flags = parseCreateStrataArgs([
      "app",
      "--frontend=api",
      "--database=postgres",
      "--tenancy=rls",
      "--auth=cookie-token-jwt",
      "--scim",
      "--yes",
    ]);
    generateProject({
      projectName: "app",
      targetDir: app,
      layers: layersFromFlags(flags),
      templateRoot: resolveTemplateRoot(),
      overlayRoot: resolveOverlayRoot(),
    });
    const pkg = JSON.parse(await readFile(join(app, "package.json"), "utf8"));
    for (const part of ["core", "bootstrap", "cli"])
      pkg.dependencies[`@getstrata/${part}`] = `file:${join(repoRoot, `packages/strata-${part}`)}`;
    await writeFile(join(app, "package.json"), JSON.stringify(pkg));
    installGeneratedAppDependencies(app);
    await control.unsafe(`CREATE DATABASE ${name}`);
    created = true;
    const adminUrl = new URL(adminSource),
      runtimeUrl = new URL(runtimeSource);
    adminUrl.pathname = runtimeUrl.pathname = `/${name}`;
    process.chdir(app);
    Object.assign(process.env, {
      DATABASE_URL: runtimeUrl.href,
      APP_DATABASE_URL: runtimeUrl.href,
      MIGRATION_DATABASE_URL: adminUrl.href,
      APP_ENV: "local",
      FRONTEND_MODE: "api",
      TENANCY_DRIVER: "rls",
      AUTH_DEV_HEADERS: "false",
      SESSION_SECRET: "dev-scim-rls-secret-at-least-32-characters",
      CACHE_DRIVER: "array",
      QUEUE_DRIVER: "sync",
      MAIL_DRIVER: "log",
      REDIS_URL: "",
      FEATURE_SCIM: "true",
      SCIM_BEARER_TOKEN: "",
      SCIM_TENANT_TOKENS: "1:fixture-one,2:fixture-two",
    });
    resetDiscoverModulesForTests();
    const { bootstrapApp, createAppServer } = await import(join(app, "src/bootstrap/createApp.ts"));
    const { getSql, closeDatabase } = await import(join(app, "src/bootstrap/database.ts"));
    closeApp = closeDatabase;
    const { User } = await import(join(app, "src/models/User.ts"));
    const boot = await bootstrapApp();
    const server = createAppServer(boot.routes, 0),
      origin = `http://127.0.0.1:${server.port}`;
    process.env.APP_URL = origin;
    try {
      const [role] = await getSql().unsafe(
        "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
      );
      expect(role.rolsuper).toBe(false);
      expect(role.rolbypassrls).toBe(false);
      const tenants = new BaseRepository(
        defineTable<{ id: number; slug: string }, "id">({
          name: "tenant",
          primaryKey: "id",
          columns: ["id", "slug"],
        }),
      );
      const password = await hashPassword("Initial!Password123");
      const { target, neighbor } = await runWithMigrationBypass(async () => {
        await tenants.create({ slug: "first" });
        await tenants.create({ slug: "second" });
        return {
          target: await User.create({
            name: "Original",
            email: "scim-target@example.test",
            password,
            is_admin: false,
            tenant_id: 2,
          }),
          neighbor: await User.create({
            name: "Neighbor",
            email: "scim-neighbor@example.test",
            password,
            is_admin: false,
            tenant_id: 1,
          }),
        };
      });
      const id = target.get("id");
      let rejectUpdate = false;
      User.observe({
        updated(model: { get(key: string): unknown }) {
          if (rejectUpdate && model.get("id") === id)
            throw new Error("injected SCIM observer failure");
        },
      });
      async function request(token: string, path: string, method = "GET", payload?: unknown) {
        const response = await fetch(`${origin}/scim/v2/${path}`, {
          method,
          headers: { authorization: `Bearer ${token}`, "content-type": "application/scim+json" },
          body: payload === undefined ? undefined : JSON.stringify(payload),
        });
        const body: unknown = await response.json();
        if (!body || typeof body !== "object" || Array.isArray(body))
          throw new Error("Expected SCIM object.");
        return { status: response.status, body: body as Record<string, unknown> };
      }
      const patch = (Operations: unknown) => ({
        schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
        Operations,
      });
      for (const body of [
        patch([{ op: "replace", path: "active", value: false }]),
        patch([
          { op: "replace", path: "displayName", value: "Partial" },
          { op: "remove", path: "active" },
        ]),
      ]) {
        const result = await request("fixture-two", `Users/${id}`, "PATCH", body);
        expect(result.status).toBe(400);
        expect(result.body.status).toBe("400");
        expect((await runWithMigrationBypass(() => User.find(id))).get("name")).toBe("Original");
      }
      for (const method of ["POST", "PUT"]) {
        expect(
          (
            await request("fixture-two", method === "POST" ? "Users" : `Users/${id}`, method, {
              userName: "inactive@example.test",
              displayName: "Inactive",
              active: false,
            })
          ).status,
        ).toBe(400);
      }
      rejectUpdate = true;
      try {
        expect(
          (
            await request(
              "fixture-two",
              `Users/${id}`,
              "PATCH",
              patch([{ op: "replace", path: "displayName", value: "Rollback" }]),
            )
          ).status,
        ).toBe(500);
      } finally {
        rejectUpdate = false;
      }
      expect((await runWithMigrationBypass(() => User.find(id))).get("name")).toBe("Original");
      const changed = await request(
        "fixture-two",
        `Users/${id}`,
        "PATCH",
        patch([{ op: "replace", path: "displayName", value: "Updated" }]),
      );
      expect(changed.status).toBe(200);
      expect(changed.body.name).toEqual({ formatted: "Updated" });
      for (let round = 0; round < 2; round++) {
        expect((await request("fixture-one", `Users/${id}`)).status).toBe(404);
        expect((await request("fixture-two", `Users/${neighbor.get("id")}`)).status).toBe(404);
        expect((await request("fixture-two", `Users/${id}`)).status).toBe(200);
      }
      await runWithMigrationBypass(async () => {
        expect((await User.find(neighbor.get("id"))).get("name")).toBe("Neighbor");
        expect(await User.where({ email: "inactive@example.test" }).count()).toBe(0);
        expect((await User.find(id)).get("password")).toBe(password);
      });
    } finally {
      server.stop(true);
      await boot.context.dispose();
    }
  } finally {
    await closeApp();
    process.chdir(repoRoot);
    if (created) await control.unsafe(`DROP DATABASE ${name} WITH (FORCE)`);
    await control.close();
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
