import { createHash, randomUUID } from "node:crypto";
import { BaseRepository } from "../database/baseRepository";
import { getBoundDatabaseConnection } from "../database/boundConnection";
import type { Migration } from "../database/migrations/types";
import {
  repositoryConnection,
  resolveRepositoryConnection,
} from "../database/repositoryConnection";
import { type DatabaseDriver, Schema } from "../database/schema";
import { defineTable } from "../database/table";
import { runInTransaction } from "../database/transaction";
import type { QueryWhere, UpdateValues } from "../database/types";
import { enableTenantRlsSql } from "../tenant/enableTenantRls";
import { currentTenant } from "../tenant/tenantContext";
import { type FieldEncryptionKeyring, normalizeEmail } from "./fieldEncryption";

type RotationCheckpoint = {
  run_id: string;
  tenant_id: number | null;
  definition_hash: string;
  probe: string;
  lookup_probe: string;
  cursor_id: string | null;
  claim_token: string;
  completed: boolean;
};
const checkpointTable = defineTable<RotationCheckpoint, "run_id">({
  name: "strata_encryption_rotation",
  primaryKey: "run_id",
  columns: [
    "run_id",
    "tenant_id",
    "definition_hash",
    "probe",
    "lookup_probe",
    "cursor_id",
    "claim_token",
    "completed",
  ],
});
function createFieldEncryptionRotationMigration(
  name: string,
  driver: DatabaseDriver,
  options: { rls?: boolean } = {},
): Migration {
  if (options.rls && driver !== "pgsql")
    throw new Error("Encryption checkpoint RLS requires Postgres.");
  return {
    name,
    async up(db) {
      await Schema.run(db, driver, (schema) => {
        schema.create(checkpointTable.name, (table) => {
          table.string("run_id", 64).primary();
          table.bigInteger("tenant_id").nullable();
          table.string("definition_hash", 64);
          table.text("probe");
          table.string("lookup_probe", 64);
          table.text("cursor_id").nullable();
          table.string("claim_token", 36);
          table.boolean("completed").default(false);
        });
      });
      if (options.rls) await db.unsafe(enableTenantRlsSql(checkpointTable.name));
    },
    async down() {
      // Removing checkpoints would make interrupted operations appear never started.
      throw new Error("Encryption rotation checkpoints require explicit administrative archival.");
    },
  };
}
interface FieldEncryptionRotationOptions<
  TEntity extends object,
  PK extends keyof TEntity & string,
> {
  repository: BaseRepository<TEntity, PK>;
  /** A distinct durable run identity per table, tenant/filter scope and audit pass. */
  runId: string;
  scopeId: string;
  /** Required operator assertion: all application/worker/admin writers are stopped. Not an auth grant. */
  maintenanceMode: true;
  source: FieldEncryptionKeyring;
  target: FieldEncryptionKeyring;
  fields: readonly {
    column: Exclude<keyof TEntity & string, PK>;
    purpose: string;
    lookupColumn?: Exclude<keyof TEntity & string, PK>;
  }[];
  mode?: "rotate" | "audit";
  batchSize?: number;
  signal?: AbortSignal;
}
interface FieldEncryptionRotationBatch {
  processed: number;
  changed: number;
  completed: boolean;
}
/** One bounded transaction. Persisted cursors advance only with committed row writes. No RLS bypass. */
async function runFieldEncryptionRotationBatch<
  TEntity extends object,
  PK extends keyof TEntity & string,
>(options: FieldEncryptionRotationOptions<TEntity, PK>): Promise<FieldEncryptionRotationBatch> {
  const table = options.repository.getTable();
  const batchSize = options.batchSize ?? 100;
  const mode = options.mode ?? "rotate";
  if (
    options.maintenanceMode !== true ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(options.runId) ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(options.scopeId) ||
    !Number.isSafeInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > 500 ||
    (mode !== "rotate" && mode !== "audit") ||
    options.fields.length < 1 ||
    options.fields.length > 16
  )
    throw new TypeError("Invalid encryption rotation options.");
  const fields = options.fields.map((field) => ({ ...field }));
  const writable = fields.flatMap((field) => [
    field.column,
    ...(field.lookupColumn ? [field.lookupColumn] : []),
  ]);
  if (
    new Set(writable).size !== writable.length ||
    writable.some(
      (column) => String(column) === table.primaryKey || !table.columns.includes(column),
    ) ||
    fields.some(
      (field) =>
        !/^[A-Za-z0-9_-]{1,64}$/.test(field.purpose) ||
        (field.lookupColumn !== undefined &&
          (typeof field.lookupColumn !== "string" ||
            field.purpose !== "email" ||
            !table.columns.includes(field.lookupColumn))),
    )
  )
    throw new TypeError("Invalid encryption rotation fields.");
  const connection = options.repository.getConnection();
  if (
    connection !== repositoryConnection &&
    connection !== resolveRepositoryConnection() &&
    connection !== getBoundDatabaseConnection()
  )
    throw new Error("Encryption rotation requires the framework-bound repository connection.");
  const definition = createHash("sha256")
    .update(
      JSON.stringify({
        table: table.name,
        primaryKey: table.primaryKey,
        scope: options.scopeId,
        tenant: currentTenant()?.id ?? null,
        fields,
        mode,
        target: options.target.activeKeyId,
      }),
    )
    .digest("hex");
  const marker = `strata:rotation:${definition}`;
  try {
    options.signal?.throwIfAborted();
    return await runInTransaction(async (transaction) => {
      const checkpoints = new BaseRepository(checkpointTable, transaction);
      await checkpoints.upsert(
        {
          run_id: options.runId,
          tenant_id: currentTenant()?.id ?? null,
          definition_hash: definition,
          probe: options.target.encrypt(marker, "rotation"),
          lookup_probe: options.target.lookup(marker),
          cursor_id: null,
          claim_token: randomUUID(),
          completed: false,
        },
        ["run_id"],
        [],
      );
      const checkpoint = await checkpoints.firstOrNull({ run_id: options.runId });
      if (
        !checkpoint ||
        checkpoint.definition_hash !== definition ||
        options.target.decrypt(checkpoint.probe, "rotation") !== marker ||
        checkpoint.lookup_probe !== options.target.lookup(marker)
      )
        throw new Error("Incompatible checkpoint");
      const savedCursor = checkpoint.cursor_id === null ? null : Number(checkpoint.cursor_id);
      if (
        checkpoint.cursor_id !== null &&
        (typeof checkpoint.cursor_id !== "string" ||
          !/^(0|[1-9][0-9]*)$/.test(checkpoint.cursor_id) ||
          !Number.isSafeInteger(savedCursor))
      )
        throw new Error("Invalid cursor");
      const completion: unknown = checkpoint.completed;
      if (completion !== true && completion !== false && completion !== 0 && completion !== 1)
        throw new Error("Invalid completion state");
      if (checkpoint.completed) return { processed: 0, changed: 0, completed: true };
      const claim = randomUUID();
      if (
        (await checkpoints.updateWhere(
          { claim_token: claim },
          { where: { run_id: options.runId, claim_token: checkpoint.claim_token } },
        )) !== 1
      )
        throw new Error("Checkpoint ownership changed");
      const repository = options.repository.withConnection(transaction);
      const where: QueryWhere<TEntity> = {};
      if (savedCursor !== null) Object.assign(where, { [table.primaryKey]: { gt: savedCursor } });
      const columns = Array.from(new Set([table.primaryKey, ...writable]));
      const rows = await repository
        .query(where)
        .withTrashed()
        .orderBy({ column: table.primaryKey, direction: "ASC" })
        .project(columns, batchSize + 1);
      let cursor = savedCursor;
      let changed = 0;
      for (const row of rows.slice(0, batchSize)) {
        options.signal?.throwIfAborted();
        const id = row[table.primaryKey];
        if (
          typeof id !== "number" ||
          !Number.isSafeInteger(id) ||
          id < 0 ||
          (cursor !== null && id <= cursor)
        )
          throw new Error("Unsupported identity");
        const predicates: QueryWhere<TEntity> = {};
        Object.assign(predicates, { [table.primaryKey]: id });
        const changes: Record<string, string> = {};
        for (const field of fields) {
          const value = row[field.column];
          Object.assign(predicates, { [field.column]: value });
          if (value === null) {
            if (field.lookupColumn && row[field.lookupColumn] !== null)
              throw new Error("Invalid null lookup");
            if (field.lookupColumn) Object.assign(predicates, { [field.lookupColumn]: null });
            continue;
          }
          if (typeof value !== "string" || !value.startsWith("enc:"))
            throw new Error("Unencrypted field");
          const current = value.startsWith(`enc:v2:${options.target.activeKeyId}:`);
          const plaintext = (current ? options.target : options.source).decrypt(
            value,
            field.purpose,
          );
          const normalized = field.purpose === "email" ? normalizeEmail(plaintext) : plaintext;
          if (mode === "audit" && !current) throw new Error("Historical ciphertext remains");
          if (!current && mode === "rotate")
            changes[field.column] = options.target.encrypt(normalized, field.purpose);
          if (field.lookupColumn) {
            const lookup = row[field.lookupColumn];
            const targetLookup = options.target.lookup(normalized);
            if (
              typeof lookup !== "string" ||
              (lookup !== options.source.lookup(normalized) && lookup !== targetLookup)
            )
              throw new Error("Incompatible lookup");
            Object.assign(predicates, { [field.lookupColumn]: lookup });
            if (lookup !== targetLookup) {
              if (mode === "audit") throw new Error("Historical lookup remains");
              changes[field.lookupColumn] = targetLookup;
            }
          }
        }
        if (Object.keys(changes).length) {
          // Fields and string/null storage values were validated above; bulk writes bypass model casts/hooks.
          const count = await repository.updateWhere(changes as UpdateValues<TEntity, PK>, {
            where: predicates,
            withTrashed: true,
          });
          if (count !== 1) throw new Error("Record changed concurrently");
          const identity: QueryWhere<TEntity> = {};
          Object.assign(identity, { [table.primaryKey]: id });
          const persisted = await repository
            .query(identity)
            .withTrashed()
            .project(Object.keys(changes) as Array<keyof TEntity & string>, 2);
          if (
            persisted.length !== 1 ||
            Object.entries(changes).some(
              ([column, value]) => persisted[0]?.[column as keyof TEntity & string] !== value,
            )
          )
            throw new Error("Stored value changed");
          changed++;
        }
        cursor = id;
      }
      options.signal?.throwIfAborted();
      const completed = rows.length <= batchSize;
      if (
        (await checkpoints.updateWhere(
          { cursor_id: cursor === null ? null : String(cursor), completed },
          { where: { run_id: options.runId, claim_token: claim } },
        )) !== 1
      )
        throw new Error("Checkpoint ownership lost");
      return { processed: Math.min(rows.length, batchSize), changed, completed };
    });
  } catch {
    // Do not surface row IDs, values, SQL, constraint names, key IDs or driver errors.
    throw new Error("Encryption rotation batch failed; resume using its persisted checkpoint.");
  }
}

export type { FieldEncryptionRotationBatch, FieldEncryptionRotationOptions };
export { createFieldEncryptionRotationMigration, runFieldEncryptionRotationBatch };
