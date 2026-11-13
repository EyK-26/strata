import { expect, test } from "bun:test";
import { createPersistenceInvocation } from "@getstrata/bootstrap/persistenceInvocation";
import { BasicAuthGuard } from "@getstrata/core/auth/basicAuthGuard";
import { hashPassword } from "@getstrata/core/auth/password";
import { persistConsumedRecoveryHash } from "@getstrata/core/auth/passwordLogin";
import { createMfaSecretCodec } from "@getstrata/core/crypto/mfaSecret";
import { createMysqlConnection } from "@getstrata/core/database/mysqlConnection";
import type { DatabaseSession } from "@getstrata/core/database/session";
import { generateRecoveryCodes, hashRecoveryCode } from "@getstrata/core/security/recoveryCodes";
import { SQL } from "bun";
import { createNativePersistenceApplication } from "../helpers/nativePersistenceApplication";

async function verify(database: DatabaseSession) {
  await database.execute({
    text: "CREATE TABLE users(id INTEGER PRIMARY KEY,mfa_recovery_codes TEXT)",
    params: [],
  });
  const original = JSON.stringify(["used-hash", "keep-hash"]);
  const placeholder = (index: number) => database.dialect.placeholder(index);
  await database.execute({
    text: `INSERT INTO users VALUES(1,${placeholder(1)}),(2,${placeholder(2)})`,
    params: [original, original],
  });
  const claims = await Promise.allSettled(
    [1, 2].map(() => persistConsumedRecoveryHash(database, 1, original, "used-hash")),
  );
  expect(claims.filter((claim) => claim.status === "fulfilled")).toHaveLength(1);
  const denied = claims.find((claim) => claim.status === "rejected");
  expect(denied?.status === "rejected" ? denied.reason : null).toMatchObject({
    status: 422,
    message: "mfa_invalid",
  });
  await expect(
    persistConsumedRecoveryHash(database, 1, original, "used-hash"),
  ).rejects.toMatchObject({ status: 422 });
  expect(
    await database.execute({
      text: "SELECT id,mfa_recovery_codes FROM users ORDER BY id",
      params: [],
    }),
  ).toEqual([
    { id: 1, mfa_recovery_codes: JSON.stringify(["keep-hash"]) },
    { id: 2, mfa_recovery_codes: original },
  ]);
  await expect(
    persistConsumedRecoveryHash(database, 1, original, "keep-hash"),
  ).rejects.toMatchObject({ status: 422 });
  await persistConsumedRecoveryHash(database, 1, JSON.stringify(["keep-hash"]), "keep-hash");
  expect(
    await database.execute({ text: "SELECT mfa_recovery_codes FROM users WHERE id=1", params: [] }),
  ).toEqual([{ mfa_recovery_codes: "[]" }]);
}
for (const driver of ["sqlite", "pgsql", "mysql"] as const) {
  const source =
    driver === "pgsql"
      ? process.env.MIGRATION_DATABASE_URL
      : process.env.MYSQL_OBSERVABILITY_ADMIN_URL;
  test.skipIf(driver !== "sqlite" && !source)(
    `${driver} recovery-code claim rejects concurrent and stale snapshots without touching another user`,
    async () => {
      if (driver === "sqlite") {
        const owner = await createNativePersistenceApplication({
          default: "main",
          connections: { main: { driver, filename: ":memory:" } },
        });
        try {
          await owner.run(verify);
        } finally {
          await owner.close();
        }
        return;
      }
      if (!source) throw new Error("Dedicated fixture required");
      const name = `mfa_claim_${crypto.randomUUID().replaceAll("-", "")}`;
      const control = driver === "pgsql" ? new SQL(source) : createMysqlConnection(source);
      let created = false;
      let close = async () => {};
      try {
        // Administrative DDL is a separate migration resource, never adopted as a runtime pool.
        await control.unsafe(`CREATE DATABASE ${name}`);
        created = true;
        const url = new URL(source);
        url.pathname = `/${name}`;
        const owner = await createNativePersistenceApplication({
          default: "main",
          connections: { main: { driver, url: url.href, max: 2 } },
        });
        close = owner.close;
        await owner.run(verify);
      } finally {
        await close();
        if (created)
          await control.unsafe(`DROP DATABASE ${name}${driver === "pgsql" ? " WITH (FORCE)" : ""}`);
        await control.close();
      }
    },
  );
}
const rlsAdmin = process.env.MIGRATION_DATABASE_URL;
const rlsRuntime = process.env.RLS_TEST_DATABASE_URL ?? process.env.APP_DATABASE_URL;
test.skipIf(!rlsAdmin || !rlsRuntime)(
  "Basic recovery claim uses the authenticated identifier under restricted Postgres RLS",
  async () => {
    if (!rlsAdmin || !rlsRuntime) throw new Error("Dedicated RLS fixtures required");
    const name = `mfa_rls_${crypto.randomUUID().replaceAll("-", "")}`;
    const control = new SQL(rlsAdmin);
    let created = false;
    let admin: SQL | undefined;
    let close = async () => {};
    try {
      await control.unsafe(`CREATE DATABASE ${name}`);
      created = true;
      const a = new URL(rlsAdmin),
        r = new URL(rlsRuntime);
      a.pathname = r.pathname = `/${name}`;
      admin = new SQL(a.href);
      const owner = await createNativePersistenceApplication({
        default: "main",
        connections: { main: { driver: "pgsql", url: r.href, max: 2 } },
      });
      close = owner.close;
      const role = await owner.run(
        async (database) =>
          (
            await database.execute<{ role: string; rolsuper: boolean; rolbypassrls: boolean }>({
              text: "SELECT current_user AS role,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
              params: [],
            })
          )[0],
      );
      if (!role || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(role.role))
        throw new Error("Invalid restricted fixture role");
      expect(role.rolsuper).toBe(false);
      expect(role.rolbypassrls).toBe(false);
      await admin.unsafe(`CREATE TABLE users(id INTEGER PRIMARY KEY,tenant_id INTEGER,mfa_recovery_codes TEXT);
   ALTER TABLE users ENABLE ROW LEVEL SECURITY;ALTER TABLE users FORCE ROW LEVEL SECURITY;
   CREATE POLICY scope ON users USING (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::integer OR id::text=current_setting('app.bypass_identifier',true));
   GRANT SELECT,UPDATE ON users TO "${role.role}"`);
      const [code] = generateRecoveryCodes(1);
      const raw = JSON.stringify([hashRecoveryCode(String(code))]);
      await admin.unsafe("INSERT INTO users VALUES(1,101,$1),(2,102,$2)", [raw, raw]);
      const password = await hashPassword("fixture-password");
      const invoke = createPersistenceInvocation(owner.application, "main");
      await invoke(
        {
          kind: "command",
          actor: { kind: "system", policy: "integration.recovery-identifier" },
          tenant: { id: 102 },
        },
        ({ database, policy }) =>
          policy.run(database, { kind: "tenant", tenantId: 102 }, async (selected) => {
            const guard = new BasicAuthGuard({
              mfaSecrets: createMfaSecretCodec(process.env),
              accounts: { findByIdOrThrow: async (id) => ({ id, role: "member" }) },
              emailLookup: {
                findByEmail: async () => ({
                  id: 1,
                  role: "member",
                  password,
                  mfa_enabled: true,
                  mfa_secret: "unused",
                  mfa_recovery_codes: raw,
                }),
              },
              persistRecovery: async (record, hash) => {
                await policy.run(selected, { kind: "identifier", identifier: record.id }, (child) =>
                  persistConsumedRecoveryHash(child, record.id, record.mfa_recovery_codes, hash),
                );
                return true;
              },
            });
            const request = new Request("http://fixture.test", {
              headers: {
                authorization: `Basic ${Buffer.from("fixture:fixture-password").toString("base64")}`,
                "x-mfa-code": String(code),
              },
            });
            expect((await guard.resolve(request))?.id).toBe(1);
            expect(await guard.resolve(request)).toBeNull();
            expect(await selected.execute({ text: "SELECT id FROM users", params: [] })).toEqual([
              { id: 2 },
            ]);
          }),
      );
      expect(await admin.unsafe("SELECT id,mfa_recovery_codes FROM users ORDER BY id")).toEqual([
        { id: 1, mfa_recovery_codes: "[]" },
        { id: 2, mfa_recovery_codes: raw },
      ]);
    } finally {
      await close();
      await admin?.close();
      if (created) await control.unsafe(`DROP DATABASE ${name} WITH (FORCE)`);
      await control.close();
    }
  },
);
