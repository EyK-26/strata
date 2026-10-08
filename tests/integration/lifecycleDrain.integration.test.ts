import { describe, expect, test } from "bun:test";
import { createWebServer } from "@getstrata/bootstrap/web/server";
import { LifecycleCoordinator } from "@getstrata/core/lifecycle/gracefulShutdown";
import { SQL } from "bun";

const restricted = process.env.RLS_TEST_DATABASE_URL ?? process.env.APP_DATABASE_URL;
const migration = process.env.MIGRATION_DATABASE_URL;

describe.skipIf(!restricted || !migration)(
  "HTTP shutdown with real restricted-role Postgres transactions",
  () => {
    for (const disconnect of [false, true]) {
      test(`${disconnect ? "disconnected" : "connected"} request commits before telemetry and database closure`, async () => {
        if (!restricted || !migration) throw new Error("Dedicated databases required");
        const admin = new SQL(migration);
        const pool = new SQL({ url: restricted, max: 2 });
        const table = `drain_${crypto.randomUUID().replaceAll("-", "")}`;
        const lifecycle = new LifecycleCoordinator({ timeoutMs: 2000 });
        const order: string[] = [];
        let entered!: () => void;
        let release!: () => void;
        const admitted = new Promise<void>((resolve) => {
          entered = resolve;
        });
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        let closed = false;
        let completed!: () => void;
        const finished = new Promise<void>((resolve) => {
          completed = resolve;
        });
        const abort = new AbortController();
        let server: ReturnType<typeof createWebServer> | undefined;
        try {
          const [role] = await pool.unsafe<
            { role: string; rolsuper: boolean; rolbypassrls: boolean }[]
          >(
            "SELECT current_user AS role,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
          );
          if (!role || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(role.role))
            throw new Error("Invalid fixture role");
          expect(role.rolsuper).toBe(false);
          expect(role.rolbypassrls).toBe(false);
          await admin.unsafe(`CREATE TABLE ${table} (tenant_id INTEGER NOT NULL, value INTEGER);
          ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY; ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
          CREATE POLICY scope ON ${table} USING (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::integer);
          GRANT SELECT,INSERT ON ${table} TO "${role.role}"`);
          server = createWebServer({
            port: 0,
            lifecycle,
            routes: {
              "/transaction": {
                POST: async () => {
                  try {
                    await pool.begin(async (transaction) => {
                      await transaction.unsafe("SELECT set_config('app.tenant_id','1',true)");
                      await transaction.unsafe(`INSERT INTO ${table} VALUES (1,42)`);
                      entered();
                      await gate;
                    });
                    order.push("commit");
                    return new Response("committed");
                  } finally {
                    completed();
                  }
                },
              },
            },
          });
          lifecycle.register(
            "database",
            async () => {
              await pool.close();
              closed = true;
              order.push("close");
            },
            "close",
          );
          lifecycle.register(
            "telemetry",
            async () => {
              await pool.unsafe("SELECT 1");
              order.push("flush");
            },
            "flush",
          );
          const response = fetch(new URL("/transaction", server.url), {
            method: "POST",
            signal: abort.signal,
          }).catch((error) => error);
          await admitted;
          if (disconnect) {
            abort.abort();
            await response;
          }
          const shutdown = lifecycle.shutdown("DEPLOYMENT");
          await Bun.sleep(20);
          expect(closed).toBe(false);
          release();
          expect((await shutdown).successful).toBe(true);
          await finished;
          if (!disconnect) expect(await (await response).text()).toBe("committed");
          expect(order).toEqual(["commit", "flush", "close"]);
          expect(await admin.unsafe<{ value: number }[]>(`SELECT value FROM ${table}`)).toEqual([
            { value: 42 },
          ]);
        } finally {
          release();
          abort.abort();
          await server?.stop(true);
          await pool.close();
          await admin.unsafe(`DROP TABLE IF EXISTS ${table}`);
          await admin.close();
        }
      });
    }
  },
);

test("a real signalled process enforces its hard deadline and does not report success or close live infrastructure", async () => {
  const script = `
import { LifecycleCoordinator, installGracefulShutdownSignals } from ${JSON.stringify(new URL("../../src/core/lifecycle/gracefulShutdown.ts", import.meta.url).href)};
import { createWebServer } from ${JSON.stringify(new URL("../../src/bootstrap/web/server.ts", import.meta.url).href)};
const lifecycle = new LifecycleCoordinator({timeoutMs:100});
const server = createWebServer({port:0,lifecycle,handle:async()=>{console.log('admitted');return new Promise(()=>{});}});
lifecycle.register('database',()=>console.log('infra-closed'),'close');
installGracefulShutdownSignals(undefined,lifecycle);
void fetch(server.url).catch(()=>{});
`;
  const child = Bun.spawn([process.execPath, "-e", script], { stdout: "pipe", stderr: "pipe" });
  let output = "";
  let ready!: () => void;
  const admitted = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const reading = (async () => {
    for await (const chunk of child.stdout) {
      output += new TextDecoder().decode(chunk);
      if (output.includes("admitted")) ready();
    }
  })();
  try {
    await Promise.race([
      admitted,
      Bun.sleep(3000).then(() => {
        throw new Error("Child did not admit request");
      }),
    ]);
    process.kill(child.pid, "SIGTERM");
    process.kill(child.pid, "SIGTERM");
    const exit = await Promise.race([
      child.exited,
      Bun.sleep(3000).then(() => {
        throw new Error("Child missed shutdown deadline");
      }),
    ]);
    await reading;
    await new Response(child.stderr).text();
    expect(exit).toBe(1);
    expect(output).not.toContain("infra-closed");
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await child.exited;
  }
}, 10_000);
