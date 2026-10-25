import { expect, test } from "bun:test";
import type { DatabaseConnection } from "@getstrata/core/database/baseRepository";
import { resetSqlDialect, useSqlDialect } from "@getstrata/core/database/dialect";
import { migrateDatabase, rollbackDatabase } from "@getstrata/core/database/migrations/runner";
import type { Migration } from "@getstrata/core/database/migrations/types";
import { defineModel, registerModelRepository } from "@getstrata/core/database/model";
import { createMysqlConnection } from "@getstrata/core/database/mysqlConnection";
import { Schema } from "@getstrata/core/database/schema";
import { createSqliteConnection } from "@getstrata/core/database/sqliteConnection";
import { defineTable } from "@getstrata/core/database/table";
import { SQL } from "bun";

for (const driver of ["pgsql", "mysql", "sqlite"] as const) {
  const url =
    driver === "pgsql"
      ? process.env.MIGRATION_DATABASE_URL
      : process.env.MYSQL_OBSERVABILITY_ADMIN_URL;
  const databaseTest = driver === "sqlite" || url ? test : test.skip;
  databaseTest(
    `${driver}: UUID migrations preserve identities, constraints, model writes and rollback`,
    async () => {
      const name = `uuid_${crypto.randomUUID().replaceAll("-", "")}`;
      let db: DatabaseConnection | undefined;
      let control: DatabaseConnection | undefined;
      let created = false;
      try {
        useSqlDialect(driver);
        if (driver === "sqlite") db = createSqliteConnection(":memory:");
        else {
          if (!url) throw new Error("A disposable migration administrator URL is required.");
          if (driver === "pgsql") {
            const pool = new SQL(url);
            control = {
              async unsafe<T>(sql: string, params: readonly unknown[] = []) {
                return pool.unsafe<T[]>(sql, [...params]);
              },
              close: () => pool.close(),
            };
          } else control = createMysqlConnection(url);
          await control.unsafe(`CREATE DATABASE ${name}`);
          created = true;
          const target = new URL(url);
          target.pathname = `/${name}`;
          if (driver === "pgsql") {
            const pool = new SQL(target.href);
            db = {
              async unsafe<T>(sql: string, params: readonly unknown[] = []) {
                return pool.unsafe<T[]>(sql, [...params]);
              },
              close: () => pool.close(),
            };
          } else db = createMysqlConnection(target.href);
        }
        const connection = db;
        const initial: Migration = {
          name: "001_uuid_documents",
          up: (target) =>
            Schema.run(target, driver, (schema) => {
              schema.create("uuid_documents", (table) => {
                table.uuid("id").primary();
                table.uuid("external_id").unique();
                table.string("title");
              });
              schema.create("uuid_references", (table) => {
                table.uuid("id").primary();
                table.uuid("document_id");
                table.foreignKey(["document_id"], "uuid_documents", ["id"]);
              });
            }),
          down: (target) =>
            Schema.run(target, driver, (schema) => {
              schema.drop("uuid_references");
              schema.drop("uuid_documents");
            }),
        };
        const addition: Migration = {
          name: "002_optional_uuid",
          up: (target) =>
            Schema.run(target, driver, (schema) => {
              schema.table("uuid_documents", (table) => table.uuid("correlation_id").nullable());
            }),
          down: (target) =>
            Schema.run(target, driver, (schema) => {
              schema.table("uuid_documents", (table) => table.dropColumn("correlation_id"));
            }),
        };
        expect(await migrateDatabase(connection, [initial])).toBe(1);
        interface Row {
          id: string;
          external_id: string;
          title: string;
        }
        class Document extends defineModel(
          defineTable<Row, "id">({
            name: "uuid_documents",
            primaryKey: "id",
            columns: ["id", "external_id", "title"],
          }),
        ) {
          static override $fillable = ["id", "external_id", "title"] as const;
          static override $timestamps = false;
        }
        registerModelRepository(Document, Document.repository().withConnection(connection));
        const id = "12345678-1234-4234-8234-123456789abc";
        const external = crypto.randomUUID();
        const document = await Document.create({
          id,
          external_id: external,
          title: "Příliš žluťoučký",
        });
        expect(document.toObject().id).toBe(id);
        expect((await Document.find(id))?.toObject().title).toBe("Příliš žluťoučký");
        await document.update({ title: "Updated UUID record" });
        expect((await Document.find(id))?.toObject().title).toBe("Updated UUID record");
        await expect(
          Document.create({ id, external_id: crypto.randomUUID(), title: "duplicate ID" }),
        ).rejects.toThrow();
        await expect(
          Document.create({
            id: crypto.randomUUID(),
            external_id: external,
            title: "duplicate external",
          }),
        ).rejects.toThrow();
        await expect(
          Document.create({
            id: null as unknown as string,
            external_id: crypto.randomUUID(),
            title: "null ID",
          }),
        ).rejects.toThrow();
        const placeholder = driver === "pgsql" ? "$1,$2" : "?,?";
        await expect(
          connection.unsafe(
            `INSERT INTO uuid_references (id,document_id) VALUES (${placeholder})`,
            [crypto.randomUUID(), crypto.randomUUID()],
          ),
        ).rejects.toThrow();
        await connection.unsafe(
          `INSERT INTO uuid_references (id,document_id) VALUES (${placeholder})`,
          [crypto.randomUUID(), id],
        );
        if (driver === "pgsql") {
          const columns = await connection.unsafe<{ column_name: string; udt_name: string }>(
            "SELECT column_name,udt_name FROM information_schema.columns WHERE table_name='uuid_documents' AND column_name IN ('id','external_id') ORDER BY column_name",
          );
          expect(columns.map((column) => column.udt_name)).toEqual(["uuid", "uuid"]);
          await expect(
            Document.create({
              id: "not-a-uuid",
              external_id: crypto.randomUUID(),
              title: "invalid",
            }),
          ).rejects.toThrow();
        } else if (driver === "mysql") {
          const columns = await connection.unsafe<{
            data_type: string;
            character_maximum_length: number;
          }>(
            "SELECT DATA_TYPE AS data_type,CHARACTER_MAXIMUM_LENGTH AS character_maximum_length FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='uuid_documents' AND column_name='id'",
          );
          expect(columns[0]?.data_type).toBe("char");
          expect(Number(columns[0]?.character_maximum_length)).toBe(36);
        } else {
          const columns = await connection.unsafe<{ name: string; type: string }>(
            "PRAGMA table_info(uuid_documents)",
          );
          expect(columns.find((column) => column.name === "id")?.type).toBe("TEXT");
        }
        expect(await migrateDatabase(connection, [initial, addition])).toBe(1);
        expect(await rollbackDatabase(connection, [initial, addition])).toBe(1);
        expect((await Document.find(id))?.toObject().id).toBe(id);
        expect((await Document.find(id))?.toObject().title).toBe("Updated UUID record");
        expect(await rollbackDatabase(connection, [initial, addition])).toBe(1);
        await expect(Document.find(id)).rejects.toThrow();
      } finally {
        await db?.close?.();
        if (created) await control?.unsafe(`DROP DATABASE ${name}`);
        await control?.close?.();
        resetSqlDialect();
      }
    },
  );
}
