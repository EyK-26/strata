import { AsyncLocalStorage } from "node:async_hooks";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPersistenceInvocation } from "@getstrata/bootstrap/persistenceInvocation";
import type { ExecutionEnvelope, ResourceSpec } from "@getstrata/core/contracts/application";
import type { PersistenceInvocation, ScopedPolicy } from "@getstrata/core/contracts/persistence";
import { resourceService, type ServiceDeclaration } from "@getstrata/core/contracts/services";
import type { ServiceToken } from "@getstrata/core/contracts/token";
import { createDatabaseBindings } from "@getstrata/core/database/bindings";
import type {
  DatabaseConnectionOptions,
  DatabaseDefinition,
  DatabaseSession,
  TransactionSession,
} from "@getstrata/core/database/session";
import {
  createOutboxMigration,
  createSqlOutboxBindings,
  type SqlOutbox,
} from "@getstrata/core/events/outbox";
import { createApplication } from "@getstrata/core/runtime/application";
import type {
  Decision,
  RawPin,
  RawPool,
  RawTransaction,
  Terminal,
} from "../../src/core/database/driverPorts";
import { sessionSql } from "./nativePersistenceApplication";

type OutboxOptions = Omit<
  Parameters<typeof createSqlOutboxBindings>[0],
  "invoke" | "connection" | "tenancy"
>;
interface OutboxFaults {
  expectQuarantine?: boolean;
  readonly disposal: { releases: number; discards: number };
  /** Explicit synthetic pre-BEGIN failure, before native SQL; never unknown data evidence. */
  beforeBegin?: (policy: string) => unknown;
  /** Delays the actual owned renewal promise; does not race/adopt/replace its settlement. */
  beforeInvoke?: (envelope: ExecutionEnvelope) => void | Promise<void>;
  unknownBegin?: (policy: string) => unknown;
}
interface OutboxFixture {
  readonly outboxes: readonly SqlOutbox[];
  readonly application: ReturnType<typeof createApplication>;
  readonly faults: OutboxFaults;
  readonly db: ReturnType<typeof sessionSql>;
  readonly invoke: PersistenceInvocation;
  run<T>(
    work: (database: DatabaseSession, policy: ScopedPolicy) => T | Promise<T>,
    tenantId?: number,
  ): Promise<T>;
  transaction<T>(
    work: (selected: TransactionSession) => T | Promise<T>,
    tenantId?: number,
  ): Promise<T>;
  publish(outbox: SqlOutbox, id?: string, payload?: unknown, tenantId?: number): Promise<string>;
  inspect(outbox: SqlOutbox, id: string, listener: string): ReturnType<SqlOutbox["getDelivery"]>;
  delivery(): Promise<Array<{ status: string; attempts: number; error_code: string | null }>>;
  migration(operation: "up" | "down"): Promise<void>;
}

/** Real app-owned native pool. Synthetic failures are limited to explicitly labeled control faults. */
async function withOutboxes<T>(
  options: readonly OutboxOptions[],
  work: (fixture: OutboxFixture) => T | Promise<T>,
  configuration: {
    connection?: DatabaseConnectionOptions;
    additionalConnections?: Readonly<Record<string, DatabaseConnectionOptions>>;
    tenancy?: "none" | "column" | "rls";
    migrate?: boolean;
    services?: readonly ServiceDeclaration[];
    prepare?: (bindings: readonly ReturnType<typeof createSqlOutboxBindings>[]) => {
      services?: readonly ServiceDeclaration[];
      repositories?: DatabaseDefinition["repositories"];
      repositoryEffects?: DatabaseDefinition["repositoryEffects"];
    };
  } = {},
): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "strata-owned-outbox-"));
  const connection = configuration.connection ?? {
    driver: "sqlite" as const,
    filename: join(directory, "outbox.sqlite"),
  };
  const tenancy =
    configuration.tenancy ?? (options.some((option) => option.resolveTenant) ? "column" : "none");
  const faults: OutboxFaults = { disposal: { releases: 0, discards: 0 } };
  const policy = new AsyncLocalStorage<string>();
  let application!: ReturnType<typeof createApplication>;
  const invoke: PersistenceInvocation = async (envelope, callback) => {
    await faults.beforeInvoke?.(envelope);
    const actorPolicy =
      envelope.actor?.kind === "system" ? envelope.actor.policy : "fixture.business";
    return policy.run(actorPolicy, () =>
      createPersistenceInvocation(application, "main")(envelope, callback),
    );
  };
  const bindings = options.map((option) =>
    createSqlOutboxBindings({ ...option, invoke, connection: "main", tenancy }),
  );
  const prepared = configuration.prepare?.(bindings);
  const database = createDatabaseBindings({
    default: "main",
    connections: { main: connection, ...configuration.additionalConnections },
    preparation: bindings.map((binding) => binding.token),
    ...(prepared?.repositories ? { repositories: prepared.repositories } : {}),
    ...(prepared?.repositoryEffects ? { repositoryEffects: prepared.repositoryEffects } : {}),
  });
  const resource = database.find((declaration) => declaration.kind === "resource");
  if (resource?.kind !== "resource") throw new Error("Missing native outbox pool resource.");
  const override = resourceService(resource.token as ServiceToken<RawPool>, {
    lifetime: "application",
    dependencies: resource.dependencies,
    create: (...dependencies) => {
      const descriptor = resource.create(...(dependencies as never[])) as ResourceSpec<RawPool>;
      return {
        ...descriptor,
        open: async (signal) => {
          const opened = await descriptor.open(signal);
          if (!opened.ok) return opened;
          const native = opened.value;
          const pool: RawPool = {
            dialect: native.dialect,
            capabilities: native.capabilities,
            execute: (statement) => native.execute(statement),
            close: () => native.close(),
            checkout: async (checkout) => {
              const acquired = await native.checkout(checkout);
              if (!acquired.ok) return acquired;
              const pin = acquired.value;
              const observed: RawPin = {
                async begin<R>(
                  callback: (tx: RawTransaction) => Promise<Decision<R>>,
                ): Promise<Terminal<R>> {
                  const actor = policy.getStore() ?? "fixture.business";
                  const unknown = faults.unknownBegin?.(actor);
                  if (unknown !== undefined) throw unknown;
                  const error = faults.beforeBegin?.(actor);
                  if (error !== undefined)
                    return {
                      data: "not-started",
                      nativeState: "idle",
                      stage: { kind: "callback-not-entered" },
                      phases: [
                        {
                          phase: "begin",
                          acknowledgement: "proven-not-applied",
                          failure: { error },
                        },
                      ],
                      failure: { error },
                    };
                  return pin.begin(callback);
                },
                release: () => {
                  faults.disposal.releases++;
                  return pin.release();
                },
                discard: () => {
                  faults.disposal.discards++;
                  return pin.discard();
                },
              };
              return { ok: true, value: observed };
            },
          };
          return { ok: true, value: pool };
        },
      } satisfies ResourceSpec<RawPool>;
    },
  });
  application = createApplication({
    providers: [],
    services: [
      ...database,
      ...bindings.flatMap((binding) => binding.services),
      ...(configuration.services ?? []),
      ...(prepared?.services ?? []),
    ],
    overrides: [override],
  });
  let primary: { error: unknown } | undefined;
  try {
    await application.start();
    const outboxes = await application.run((scope) =>
      bindings.map((binding) => scope.resolve(binding.token)),
    );
    const run: OutboxFixture["run"] = (callback, tenantId) =>
      invoke(
        {
          kind: "command",
          actor: { kind: "system", policy: "outbox.fixture" },
          ...(tenantId ? { tenant: { id: tenantId } } : {}),
        },
        (ports) => callback(ports.database, ports.policy),
      );
    const transaction: OutboxFixture["transaction"] = (callback, tenantId) =>
      run(
        (selected, scoped) =>
          tenancy === "rls"
            ? scoped.run(
                selected,
                tenantId ? { kind: "tenant", tenantId } : { kind: "bypass" },
                callback,
              )
            : selected.transaction(callback),
        tenantId,
      );
    const db: ReturnType<typeof sessionSql> = {
      unsafe: <R>(text: string, params: readonly unknown[] = []) =>
        run((selected) => selected.execute<R>({ text, params })).then((rows) => [...rows]),
    };
    const migration = createOutboxMigration("outbox-fixture", connection.driver);
    const migrate = (operation: "up" | "down") =>
      run((selected) => migration[operation](sessionSql(selected)));
    if (configuration.migrate !== false) await migrate("up");
    return await work({
      application,
      outboxes,
      faults,
      db,
      invoke,
      run,
      transaction,
      publish: (outbox, id = "order:1", payload: unknown = { amount: 100 }, tenantId) =>
        transaction(
          (selected) =>
            outbox.publish(selected, "orders.created", payload, { id, tenantId: tenantId ?? null }),
          tenantId,
        ),
      inspect: (outbox, id, listener) =>
        run((selected) => outbox.getDelivery(selected, id, listener)),
      delivery: () => db.unsafe("SELECT * FROM strata_outbox_delivery ORDER BY listener_name"),
      migration: migrate,
    });
  } catch (error) {
    primary = { error };
    throw error;
  } finally {
    await cleanup();
  }
  async function cleanup(): Promise<void> {
    const failures: unknown[] = [];
    try {
      const stopped = await application.stop();
      if (faults.expectQuarantine) {
        if (stopped.successful || stopped.snapshot.retainedResources.length === 0)
          failures.push(Error("Unknown native outcome must retain quarantined ownership."));
      } else if (!stopped.successful) {
        failures.push(Error("Outbox fixture shutdown was not confirmed clean."));
      }
    } catch (error) {
      failures.push(error);
    }
    try {
      await rm(directory, { recursive: true, force: true });
    } catch (error) {
      failures.push(error);
    }
    if (failures.length)
      throw new AggregateError(
        [...(primary ? [primary.error] : []), ...failures],
        "Outbox fixture failed.",
      );
  }
}

export type { OutboxFixture, OutboxOptions };
export { withOutboxes };
