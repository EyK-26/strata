import { test } from "bun:test";
import assert from "node:assert/strict";
import { resourceService } from "@getstrata/core/contracts/services";
import type { ServiceToken } from "@getstrata/core/contracts/token";
import { createDatabaseBindings } from "@getstrata/core/database/bindings";
import type { RawPool } from "@getstrata/core/database/driverPorts";
import { dialectFor } from "@getstrata/core/database/sqlDialects";
import { createApplication } from "@getstrata/core/runtime/application";
import { createDatabaseReadinessBindings } from "../../src/bootstrap/databaseReadiness";

test("BP7 settled startup readiness failure blocks transport and closes its already-owned pool once", async () => {
  let queries = 0;
  let poolCloses = 0;
  let transports = 0;
  const failure = new Error("Settled readiness query failure");
  const bindings = createDatabaseBindings({
    default: "main",
    connections: { main: { driver: "sqlite", filename: ":memory:" } },
  });
  const resource = bindings.find((declaration) => declaration.kind === "resource");
  assert.ok(resource);
  // Explicit synthetic native rejection; startup graph and journal ownership remain real.
  const pool: RawPool = {
    dialect: dialectFor("sqlite"),
    capabilities: Object.freeze({
      driver: "sqlite",
      transactions: true,
      savepoints: true,
      rowLocks: false,
      postgresRls: false,
      cancellableCheckout: false,
      observableCheckout: false,
      isolatedDiscard: false,
    }),
    async execute<Row>(): Promise<readonly Row[]> {
      queries++;
      throw failure;
    },
    async checkout() {
      throw new Error("Readiness must not enter business transaction checkout");
    },
    close() {
      poolCloses++;
    },
  };
  const app = createApplication({
    providers: [],
    services: [...bindings, ...createDatabaseReadinessBindings("main", {})],
    overrides: [
      resourceService(resource.token as ServiceToken<RawPool>, {
        lifetime: "application",
        dependencies: resource.dependencies,
        create: () => ({
          name: "readiness protocol pool",
          open: () => ({ ok: true, value: pool }),
          close: (owned) => owned.close(),
        }),
      }),
    ],
    transports: [
      {
        name: "must not admit after failed readiness",
        setup: () => {
          transports++;
        },
      },
    ],
  });
  try {
    await assert.rejects(app.start());
    const stopped = await app.stop();
    assert.equal(queries, 1);
    assert.equal(transports, 0);
    assert.equal(
      poolCloses,
      1,
      "A settled non-acquiring readiness failure cannot fabricate unknown ownership and retain its actual pool",
    );
    assert.deepEqual(stopped.snapshot.retainedResources, []);
    assert.equal(stopped.successful, true);
    await app.stop();
    assert.equal(poolCloses, 1);
  } finally {
    await app.stop();
  }
});
