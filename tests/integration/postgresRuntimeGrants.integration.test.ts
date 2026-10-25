import { expect, test } from "bun:test";
import { observePostgresRuntimeGrants } from "../helpers/postgresRuntimeGrantContract";

for (const options of [{}, { legacy: true }, { legacy: true, delegated: true }]) {
  test(`runtime grants reserve maintenance for migrations: ${JSON.stringify(options)}`, async () => {
    const url = process.env.MIGRATION_DATABASE_URL;
    if (!url) throw new Error("An owned PostgreSQL administrative fixture is required.");
    const result = await observePostgresRuntimeGrants(url, options);
    expect(result.identity).toMatchObject({
      current_user: result.role,
      rolsuper: false,
      rolbypassrls: false,
      rolcreaterole: false,
      schema_create: false,
    });
    expect(result.policy).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    expect(result.crud).toBe(true);
    expect(result.migrationTruncate).toBe(true);
    expect(result.sequenceMutationDenial).toBe("42501");
    expect(result.atomicRevokeRollback).toBe(options.legacy ? true : null);
    if (options.delegated)
      expect(result.migrationIdentity).toEqual({
        rolsuper: false,
        rolcreaterole: false,
        schema_create: true,
      });
    for (const privileges of [result.current, result.future])
      expect(privileges).toEqual({
        select: true,
        insert: true,
        update: true,
        delete: true,
        truncate: false,
        references: false,
        trigger: false,
        sequence_usage: true,
        sequence_select: true,
        sequence_update: false,
        maintain: result.version >= 170000 ? false : null,
      });
    for (const probe of [result.currentTruncate, result.futureTruncate])
      expect(probe).toEqual({
        denial: "42501",
        otherBefore: 1,
        otherAfter: 1,
        otherRestored: 1,
        bypass: false,
      });
  }, 20000);
}
