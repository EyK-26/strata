import type { DatabaseSession, TransactionSession } from "../database/session";
import type { ExecutionEnvelope } from "./application";
export type SelectedSession = DatabaseSession | TransactionSession;
export interface ExecutionPersistence {
  readonly database: DatabaseSession;
  readonly policy: ScopedPolicy;
}
export type PersistenceInvocation = <T>(
  envelope: ExecutionEnvelope,
  work: (ports: ExecutionPersistence) => T | Promise<T>,
) => Promise<T>;

export type EstablishedDatabasePolicy =
  | Readonly<{ kind: "tenant"; tenantId: number }>
  | Readonly<{ kind: "bypass" }>
  | Readonly<{ kind: "identifier"; identifier: string | number }>;
export interface ScopedPolicy {
  run<T>(
    selected: SelectedSession,
    policy: EstablishedDatabasePolicy,
    work: (child: TransactionSession) => T | Promise<T>,
  ): Promise<T>;
}
