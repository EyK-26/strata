import { expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createFieldEncryptionKeyring,
  emailLookupForQuery,
  encryptField,
  revealEmail,
} from "@getstrata/core/crypto/fieldEncryption";
import {
  createFieldEncryptionRotationMigration,
  type FieldEncryptionRotationOptions,
  runFieldEncryptionRotationBatch,
} from "@getstrata/core/crypto/fieldEncryptionRotation";
import { revealMfaSecret } from "@getstrata/core/crypto/mfaSecret";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import {
  bindDatabaseConnection,
  getBoundDatabaseConnection,
  resetBoundDatabaseConnection,
} from "@getstrata/core/database/boundConnection";
import { resetSqlDialect, useSqlDialect } from "@getstrata/core/database/dialect";
import { Schema } from "@getstrata/core/database/schema";
import { createSqliteConnection } from "@getstrata/core/database/sqliteConnection";
import { defineTable } from "@getstrata/core/database/table";

type Row = {
  id: number;
  email: string | null;
  lookup: string | null;
  mfa: string | null;
  deleted_at: string | null;
};
const table = defineTable<Row, "id">({
  name: "rotation_accounts",
  primaryKey: "id",
  columns: ["id", "email", "lookup", "mfa", "deleted_at"],
  softDeletes: true,
});
const old = Buffer.alloc(32, 11),
  next = Buffer.alloc(32, 22),
  lookup = Buffer.alloc(32, 33);
const source = createFieldEncryptionKeyring({
  activeKeyId: "old",
  encryptionKeys: { old },
  legacyV1Key: old,
  lookupKey: old,
});
const target = createFieldEncryptionKeyring({
  activeKeyId: "next",
  encryptionKeys: { next },
  lookupKey: lookup,
});
const failure = "Encryption rotation batch failed; resume using its persisted checkpoint.";
async function fixture(
  run: (
    repo: BaseRepository<Row, "id">,
    db: ReturnType<typeof createSqliteConnection>,
    options: FieldEncryptionRotationOptions<Row, "id">,
  ) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), "encryption-rotation-"));
  const db = createSqliteConnection(join(directory, "app.sqlite"));
  const previous = getBoundDatabaseConnection();
  try {
    bindDatabaseConnection(db);
    useSqlDialect("sqlite");
    await createFieldEncryptionRotationMigration("rotation", "sqlite").up(db);
    await Schema.run(db, "sqlite", (schema) => {
      schema.create(table.name, (t) => {
        t.id();
        t.text("email").nullable();
        t.string("lookup", 64).nullable().unique();
        t.text("mfa").nullable();
        t.timestamp("deleted_at").nullable();
      });
    });
    const repo = new BaseRepository(table);
    for (let id = 1; id <= 4; id++) {
      const email = `user${id}@example.test`;
      await repo.create({
        id,
        email: id === 2 ? source.encrypt(email, "email") : encryptField(email, old),
        lookup: source.lookup(email),
        mfa: id === 1 ? null : encryptField("JBSWY3DPEHPK3PXP", old),
        deleted_at: id === 4 ? "2020-01-01T00:00:00Z" : null,
      });
    }
    const options: FieldEncryptionRotationOptions<Row, "id"> = {
      repository: repo,
      runId: "rotate",
      scopeId: "global",
      maintenanceMode: true,
      source,
      target,
      fields: [
        { column: "email", purpose: "email", lookupColumn: "lookup" },
        { column: "mfa", purpose: "mfa" },
      ],
      batchSize: 2,
    };
    await run(repo, db, options);
  } finally {
    if (previous) bindDatabaseConnection(previous);
    else resetBoundDatabaseConnection();
    resetSqlDialect();
    db.close();
    await rm(directory, { recursive: true, force: true });
  }
}
test("bounded committed batches resume, preserve nulls/soft-deleted accounts and migrate lookup keys", async () => {
  await fixture(async (repo, db, options) => {
    const backup = await repo.query().withTrashed().orderBy({ column: "id" }).get();
    expect(await runFieldEncryptionRotationBatch(options)).toEqual({
      processed: 2,
      changed: 2,
      completed: false,
    });
    expect(
      (
        await db.unsafe<{ cursor_id: string }>("SELECT cursor_id FROM strata_encryption_rotation")
      )[0]?.cursor_id,
    ).toBe("2");
    expect(await runFieldEncryptionRotationBatch(options)).toEqual({
      processed: 2,
      changed: 2,
      completed: true,
    });
    expect(await runFieldEncryptionRotationBatch(options)).toEqual({
      processed: 0,
      changed: 0,
      completed: true,
    });
    for (const row of await repo.query().withTrashed().get()) {
      expect(target.decrypt(row.email ?? "", "email")).toBe(`user${row.id}@example.test`);
      expect(row.lookup).toBe(target.lookup(`user${row.id}@example.test`));
      if (row.mfa !== null) expect(target.decrypt(row.mfa, "mfa")).toBe("JBSWY3DPEHPK3PXP");
      expect(
        (
          await repo.firstOrNull(
            { lookup: target.lookup(`user${row.id}@example.test`) },
            { withTrashed: true },
          )
        )?.id,
      ).toBe(row.id);
    }
    expect(
      await runFieldEncryptionRotationBatch({
        ...options,
        runId: "audit",
        mode: "audit",
        source: target,
      }),
    ).toEqual({ processed: 2, changed: 0, completed: false });
    expect(
      (
        await runFieldEncryptionRotationBatch({
          ...options,
          runId: "audit",
          mode: "audit",
          source: target,
        })
      ).completed,
    ).toBe(true);
    // Backups still need the retained historical key; no live audit proves backup retirement.
    for (const row of backup) {
      expect(source.decrypt(row.email ?? "", "email")).toBe(`user${row.id}@example.test`);
      expect(() => target.decrypt(row.email ?? "", "email")).toThrow();
    }
    const names = ["KMS_ENCRYPTION_KEY", "KMS_ENCRYPTION_KEYRING", "FEATURE_FIELD_ENCRYPTION"];
    const previous = names.map((name) => process.env[name]);
    try {
      delete process.env.KMS_ENCRYPTION_KEY;
      process.env.FEATURE_FIELD_ENCRYPTION = "true";
      process.env.KMS_ENCRYPTION_KEYRING = JSON.stringify({
        activeKeyId: "next",
        encryptionKeys: { next: next.toString("hex") },
        lookupKey: lookup.toString("hex"),
        writeVersion: 2,
      });
      for (const row of await repo.query().withTrashed().get()) {
        expect(revealEmail(row.email ?? "")).toBe(`user${row.id}@example.test`);
        expect(row.lookup).toBe(emailLookupForQuery(`USER${row.id}@example.test`));
        expect(revealMfaSecret(row.mfa)).toBe(row.mfa === null ? null : "JBSWY3DPEHPK3PXP");
      }
    } finally {
      names.forEach((name, index) => {
        if (previous[index] === undefined) delete process.env[name];
        else process.env[name] = previous[index];
      });
    }
    // A separate maintenance run can reverse both ciphertext and lookup domains.
    const rollback = {
      ...options,
      runId: "rollback",
      source: target,
      target: source,
      batchSize: 5,
    };
    expect(await runFieldEncryptionRotationBatch(rollback)).toEqual({
      processed: 4,
      changed: 4,
      completed: true,
    });
    expect(
      await runFieldEncryptionRotationBatch({
        ...rollback,
        runId: "rollback_audit",
        mode: "audit",
        source,
      }),
    ).toEqual({ processed: 4, changed: 0, completed: true });
    for (const row of await repo.query().withTrashed().get()) {
      expect(row.email?.startsWith("enc:v2:old:")).toBe(true);
      expect(source.decrypt(row.email ?? "", "email")).toBe(`user${row.id}@example.test`);
      expect(row.lookup).toBe(source.lookup(`user${row.id}@example.test`));
    }
  });
});
test("decrypt errors, incompatible indexes and uniqueness collisions roll back rows and checkpoint together", async () => {
  await fixture(async (repo, db, options) => {
    const before = await repo.query().withTrashed().orderBy({ column: "id" }).get();
    await repo.updateWhere({ mfa: "enc:v1:broken" }, { where: { id: 2 } });
    await expect(runFieldEncryptionRotationBatch(options)).rejects.toThrow(failure);
    expect(await db.unsafe("SELECT run_id FROM strata_encryption_rotation")).toEqual([]);
    expect((await repo.firstOrNull({ id: 1 }))?.email).toBe(before[0]?.email);
    await repo.updateWhere({ mfa: before[1]?.mfa }, { where: { id: 2 } });
    // A conflicting new-domain hash must not be silently merged with another account.
    await repo.updateWhere(
      { lookup: target.lookup("user1@example.test") },
      { where: { id: 4 }, withTrashed: true },
    );
    await expect(runFieldEncryptionRotationBatch(options)).rejects.toThrow(failure);
    expect((await repo.firstOrNull({ id: 1 }))?.email).toBe(before[0]?.email);
    await repo.updateWhere(
      { lookup: source.lookup("user4@example.test") },
      { where: { id: 4 }, withTrashed: true },
    );
    await runFieldEncryptionRotationBatch(options);
    await repo.updateWhere({ lookup: "invalid-private" }, { where: { id: 3 } });
    await expect(runFieldEncryptionRotationBatch(options)).rejects.toThrow(failure);
    expect(
      (
        await db.unsafe<{ cursor_id: string }>("SELECT cursor_id FROM strata_encryption_rotation")
      )[0]?.cursor_id,
    ).toBe("2");
    await repo.updateWhere({ lookup: source.lookup("user3@example.test") }, { where: { id: 3 } });
    expect((await runFieldEncryptionRotationBatch(options)).completed).toBe(true);
  });
});
test("audits fail closed on old ciphertext/lookup and checkpoint identities reject changed definitions or keys", async () => {
  await fixture(async (repo, db, options) => {
    await expect(
      runFieldEncryptionRotationBatch({
        ...options,
        runId: "audit",
        mode: "audit",
        source: target,
      }),
    ).rejects.toThrow(failure);
    await runFieldEncryptionRotationBatch(options);
    await expect(runFieldEncryptionRotationBatch({ ...options, scopeId: "other" })).rejects.toThrow(
      failure,
    );
    const wrong = createFieldEncryptionKeyring({
      activeKeyId: "next",
      encryptionKeys: { next: old },
      lookupKey: lookup,
    });
    await expect(runFieldEncryptionRotationBatch({ ...options, target: wrong })).rejects.toThrow(
      failure,
    );
    const wrongLookup = createFieldEncryptionKeyring({
      activeKeyId: "next",
      encryptionKeys: { next },
      lookupKey: old,
    });
    await expect(
      runFieldEncryptionRotationBatch({ ...options, target: wrongLookup }),
    ).rejects.toThrow(failure);
    await repo.updateWhere({ lookup: source.lookup("user1@example.test") }, { where: { id: 1 } });
    await expect(
      runFieldEncryptionRotationBatch({
        ...options,
        runId: "audit",
        mode: "audit",
        source: target,
      }),
    ).rejects.toThrow(failure);
    await db.unsafe("UPDATE strata_encryption_rotation SET cursor_id=NULL,completed=2");
    await expect(runFieldEncryptionRotationBatch(options)).rejects.toThrow(failure);
    await db.unsafe("UPDATE strata_encryption_rotation SET cursor_id=-1,completed=0");
    await expect(runFieldEncryptionRotationBatch(options)).rejects.toThrow(failure);
  });
});
test("cancellation and compare-and-swap failures never advance a durable checkpoint", async () => {
  await fixture(async (repo, db, options) => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      runFieldEncryptionRotationBatch({ ...options, signal: controller.signal }),
    ).rejects.toThrow(failure);
    const execute = BaseRepository.prototype.updateWhere;
    for (const phase of ["claim", "record", "finish", "stored"]) {
      const spy = spyOn(BaseRepository.prototype, "updateWhere").mockImplementation(async function (
        this: BaseRepository<object, never>,
        changes,
        query,
      ) {
        const name = this.getTable().name;
        if (phase === "stored" && name === table.name)
          return execute.call(this, { ...changes, email: "truncated" }, query);
        if (
          (phase === "claim" &&
            name === "strata_encryption_rotation" &&
            "claim_token" in changes) ||
          (phase === "record" && name === table.name) ||
          (phase === "finish" && name === "strata_encryption_rotation" && "completed" in changes)
        )
          return 0;
        return execute.call(this, changes, query);
      });
      try {
        await expect(runFieldEncryptionRotationBatch(options)).rejects.toThrow(failure);
      } finally {
        spy.mockRestore();
      }
      expect(await db.unsafe("SELECT run_id FROM strata_encryption_rotation")).toEqual([]);
      expect((await repo.firstOrNull({ id: 1 }))?.email?.startsWith("enc:v1:")).toBe(true);
    }
    const cancel = new AbortController();
    const spy = spyOn(BaseRepository.prototype, "updateWhere").mockImplementation(async function (
      this: BaseRepository<object, never>,
      changes,
      query,
    ) {
      const result = await execute.call(this, changes, query);
      if (this.getTable().name === table.name) cancel.abort();
      return result;
    });
    try {
      await expect(
        runFieldEncryptionRotationBatch({ ...options, signal: cancel.signal }),
      ).rejects.toThrow(failure);
    } finally {
      spy.mockRestore();
    }
    expect(await db.unsafe("SELECT run_id FROM strata_encryption_rotation")).toEqual([]);
  });
});
test("option, schema, plaintext and identity validation fails closed", async () => {
  await fixture(async (repo, db, options) => {
    for (const invalid of [
      { maintenanceMode: false },
      { runId: "" },
      { scopeId: "bad:scope" },
      { batchSize: 0 },
      { mode: "wrong" },
      { fields: [] },
      { fields: Array.from({ length: 17 }, () => ({ column: "email", purpose: "email" })) },
      { fields: [{ column: "id", purpose: "email" }] },
      { fields: [{ column: "unknown", purpose: "email" }] },
      { fields: [{ column: "email", purpose: "bad:purpose" }] },
      { fields: [{ column: "email", purpose: "mfa", lookupColumn: "lookup" }] },
      {
        fields: [
          { column: "email", purpose: "email" },
          { column: "email", purpose: "email" },
        ],
      },
    ])
      await expect(
        runFieldEncryptionRotationBatch({
          ...options,
          ...invalid,
        } as FieldEncryptionRotationOptions<Row, "id">),
      ).rejects.toThrow("Invalid encryption rotation");
    const unbound = new BaseRepository(table, { unsafe: async () => [] });
    await expect(
      runFieldEncryptionRotationBatch({ ...options, repository: unbound }),
    ).rejects.toThrow("framework-bound");
    expect(() =>
      createFieldEncryptionRotationMigration("fixture", "sqlite", { rls: true }),
    ).toThrow("RLS requires Postgres");
    await expect(
      createFieldEncryptionRotationMigration("fixture", "sqlite").down(db),
    ).rejects.toThrow("administrative archival");
    for (const mutation of [{ email: "plaintext" }, { email: 12 }, { email: null }]) {
      await repo.updateWhere(mutation as Partial<Row>, { where: { id: 1 } });
      await expect(runFieldEncryptionRotationBatch(options)).rejects.toThrow(failure);
    }
  });
});

test("Schema string primary keys reject null and generated integer keys keep auto increment", async () => {
  await fixture(async (repo, db, options) => {
    await expect(
      db.unsafe(
        "INSERT INTO strata_encryption_rotation(run_id,definition_hash,probe,lookup_probe,claim_token,completed) VALUES(NULL,'x','x','x','x',0)",
      ),
    ).rejects.toThrow();
    await new BaseRepository({ ...table, softDeletes: false }).query({ id: { gt: 0 } }).delete();
    expect(await runFieldEncryptionRotationBatch(options)).toEqual({
      processed: 0,
      changed: 0,
      completed: true,
    });
    await repo.create({ id: -1, email: null, lookup: null, mfa: null, deleted_at: null });
    await expect(
      runFieldEncryptionRotationBatch({ ...options, runId: "negative" }),
    ).rejects.toThrow(failure);
  });
});

test("restricted-role Postgres RLS batches serialize, bind tenant checkpoints and roll back outer failures", async () => {
  const url = process.env.RLS_TEST_DATABASE_URL ?? process.env.APP_DATABASE_URL;
  const admin = process.env.MIGRATION_DATABASE_URL;
  if (!url || !admin) throw new Error("RLS qualification fixture required");
  const { SQL } = await import("bun");
  const { getDefaultDatabasePool, registerDefaultDatabasePool } = await import(
    "@getstrata/core/database/defaultConnection"
  );
  const previousPool = getDefaultDatabasePool();
  const { runWithTenantDatabase } = await import("@getstrata/core/tenant/tenantDatabaseScope");
  const { repositoryConnection } = await import("@getstrata/core/database/repositoryConnection");
  const owner = new SQL(admin);
  const pool = new SQL({ url, max: 3 });
  const schema = `rotate_${crypto.randomUUID().replaceAll("-", "")}`;
  const previous = getBoundDatabaseConnection();
  const tenancy = process.env.TENANCY_DRIVER;
  try {
    await owner.unsafe(`CREATE SCHEMA ${schema}; GRANT USAGE ON SCHEMA ${schema} TO strata_app`);
    await owner.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL search_path TO ${schema}`);
      const { RLS_HELPER_SQL } = await import("@getstrata/core/tenant/enableTenantRls");
      await tx.unsafe(RLS_HELPER_SQL);
      await createFieldEncryptionRotationMigration("rotation", "pgsql", { rls: true }).up(
        tx as unknown as import("@getstrata/core/database/baseRepository").DatabaseConnection,
      );
      await tx.unsafe(
        `CREATE TABLE rotation_accounts(id INTEGER NOT NULL,tenant_id INTEGER NOT NULL,email TEXT,lookup TEXT,mfa TEXT,deleted_at TIMESTAMPTZ,PRIMARY KEY(id,tenant_id),UNIQUE(tenant_id,lookup)); ALTER TABLE rotation_accounts ENABLE ROW LEVEL SECURITY; ALTER TABLE rotation_accounts FORCE ROW LEVEL SECURITY; CREATE POLICY scope ON rotation_accounts USING(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::integer) WITH CHECK(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::integer);GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA ${schema} TO strata_app`,
      );
      for (const tenant of [1, 2])
        for (let id = 1; id <= 4; id++) {
          const email = `t${tenant}-${id}@example.test`;
          await tx.unsafe("INSERT INTO rotation_accounts VALUES($1,$2,$3,$4,$5,NULL)", [
            id,
            tenant,
            encryptField(email, old),
            source.lookup(email),
            encryptField("secret", old),
          ]);
        }
    });
    bindDatabaseConnection(
      pool as unknown as import("@getstrata/core/database/baseRepository").DatabaseConnection,
    );
    registerDefaultDatabasePool(
      pool as unknown as import("@getstrata/core/database/baseRepository").SqlDatabaseConnection,
    );
    useSqlDialect("pgsql");
    process.env.TENANCY_DRIVER = "rls";
    const [role] = await pool.unsafe(
      "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
    );
    expect(role.rolsuper || role.rolbypassrls).toBe(false);
    const repo = new BaseRepository(table);
    const options: FieldEncryptionRotationOptions<Row, "id"> = {
      repository: repo,
      runId: "tenant1",
      scopeId: "scoped",
      maintenanceMode: true,
      source,
      target,
      fields: [
        { column: "email", purpose: "email", lookupColumn: "lookup" },
        { column: "mfa", purpose: "mfa" },
      ],
      batchSize: 2,
    };
    const scope = <T>(tenant: number, run: () => Promise<T>) =>
      runWithTenantDatabase({ id: tenant, slug: `t${tenant}` }, async () => {
        await repositoryConnection.unsafe(`SET LOCAL search_path TO ${schema}`);
        return run();
      });
    await expect(
      scope(1, async () => {
        await runFieldEncryptionRotationBatch(options);
        throw new Error("outer failure");
      }),
    ).rejects.toThrow("outer failure");
    const [checkpoint] = await owner.unsafe(
      `SELECT count(*)::integer AS n FROM ${schema}.strata_encryption_rotation`,
    );
    expect(checkpoint.n).toBe(0);
    const results = await Promise.all([
      scope(1, () => runFieldEncryptionRotationBatch(options)),
      scope(1, () => runFieldEncryptionRotationBatch(options)),
    ]);
    expect(results.reduce((sum, row) => sum + row.changed, 0)).toBe(4);
    expect(results.some((row) => row.completed)).toBe(true);
    await scope(2, async () => {
      expect((await repo.firstOrNull({ id: 1 }))?.email?.startsWith("enc:v1:")).toBe(true);
      await expect(runFieldEncryptionRotationBatch(options)).rejects.toThrow(failure);
    });
    await scope(1, async () => {
      for (const row of await repo.query().withTrashed().get())
        expect(target.decrypt(row.email ?? "", "email")).toBe(`t1-${row.id}@example.test`);
    });
  } finally {
    if (previous) bindDatabaseConnection(previous);
    else resetBoundDatabaseConnection();
    resetSqlDialect();
    if (tenancy === undefined) delete process.env.TENANCY_DRIVER;
    else process.env.TENANCY_DRIVER = tenancy;
    registerDefaultDatabasePool(previousPool);
    await pool.close();
    await owner.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await owner.close();
  }
});

test("MySQL published entrypoints resume and serialize maintenance batches across three processes", async () => {
  const admin = process.env.MYSQL_OBSERVABILITY_ADMIN_URL;
  if (!admin) throw new Error("MySQL qualification fixture required");
  const { createConnection } = await import("mysql2/promise");
  const { createMysqlConnection } = await import("@getstrata/core/database/mysqlConnection");
  const { resolve } = await import("node:path");
  const root = await createConnection(admin);
  const database = `rotate_${crypto.randomUUID().replaceAll("-", "")}`;
  const previous = getBoundDatabaseConnection();
  const url = new URL(admin);
  url.pathname = `/${database}`;
  const db = createMysqlConnection(url.toString());
  try {
    await root.query(`CREATE DATABASE ${database}`);
    bindDatabaseConnection(db);
    useSqlDialect("mysql");
    await createFieldEncryptionRotationMigration("rotation", "mysql").up(db);
    await Schema.run(db, "mysql", (schema) => {
      schema.create(table.name, (t) => {
        t.id();
        t.text("email").nullable();
        t.string("lookup", 64).nullable().unique();
        t.text("mfa").nullable();
        t.text("deleted_at").nullable();
      });
    });
    const repo = new BaseRepository(table);
    for (let id = 1; id <= 4; id++) {
      const email = `user${id}@example.test`;
      await repo.create({
        id,
        email: encryptField(email, old),
        lookup: source.lookup(email),
        mfa: null,
        deleted_at: null,
      });
    }
    const options: FieldEncryptionRotationOptions<Row, "id"> = {
      repository: repo,
      runId: "mysql",
      scopeId: "global",
      maintenanceMode: true,
      source,
      target,
      fields: [{ column: "email", purpose: "email", lookupColumn: "lookup" }],
      batchSize: 1,
    };
    expect((await runFieldEncryptionRotationBatch(options)).changed).toBe(1);
    const program = `import{BaseRepository,defineTable,bindDatabaseConnection,useSqlDialect,createMysqlConnection,runFieldEncryptionRotationBatch}from ${JSON.stringify(resolve("packages/strata-core/dist/index.js"))};import{runFieldEncryptionRotationBatch as shared}from ${JSON.stringify(resolve("packages/strata-core/dist/entries/crypto/fieldEncryptionRotation.js"))};import{createFieldEncryptionKeyring}from ${JSON.stringify(resolve("packages/strata-core/dist/entries/crypto/fieldEncryption.js"))};if(shared!==runFieldEncryptionRotationBatch)throw Error('Entry identity mismatch');const db=createMysqlConnection(process.env.ROTATION_MYSQL_URL);bindDatabaseConnection(db);useSqlDialect('mysql');const repository=new BaseRepository(defineTable({name:'rotation_accounts',primaryKey:'id',columns:['id','email','lookup','mfa','deleted_at'],softDeletes:true}));const source=createFieldEncryptionKeyring({activeKeyId:'old',encryptionKeys:{old:Buffer.alloc(32,11)},legacyV1Key:Buffer.alloc(32,11),lookupKey:Buffer.alloc(32,11)});const target=createFieldEncryptionKeyring({activeKeyId:'next',encryptionKeys:{next:Buffer.alloc(32,22)},lookupKey:Buffer.alloc(32,33)});try{console.log(JSON.stringify(await shared({repository,runId:'mysql',scopeId:'global',maintenanceMode:true,source,target,fields:[{column:'email',purpose:'email',lookupColumn:'lookup'}],batchSize:1})));}finally{await db.close();}`;
    const results = await Promise.all(
      Array.from({ length: 3 }, async () => {
        const actor = Bun.spawn(
          [process.execPath, "--no-env-file", "--config=/dev/null", "-e", program],
          {
            env: { PATH: process.env.PATH, ROTATION_MYSQL_URL: url.toString() },
            stdout: "pipe",
            stderr: "ignore",
          },
        );
        const body = await new Response(actor.stdout).text();
        expect(await actor.exited).toBe(0);
        return JSON.parse(body);
      }),
    );
    expect(results.reduce((sum, row) => sum + row.changed, 0)).toBe(3);
    expect(results.filter((row) => row.completed).length).toBe(1);
    const audit = await runFieldEncryptionRotationBatch({
      ...options,
      runId: "mysql_audit",
      mode: "audit",
      batchSize: 5,
    });
    expect(audit).toEqual({ processed: 4, changed: 0, completed: true });
  } finally {
    if (previous) bindDatabaseConnection(previous);
    else resetBoundDatabaseConnection();
    resetSqlDialect();
    await db.close();
    await root.query(`DROP DATABASE IF EXISTS ${database}`);
    await root.end();
  }
});
