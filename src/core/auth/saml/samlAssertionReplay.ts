import { isUniqueConstraintError } from "@getstrata/core/database/errors";
import type { SqlStatement } from "../../database/driverPorts";
import type { DatabaseSession, TransactionSession } from "../../database/session";
import type { SqlDialect } from "../../database/sqlDialects";

interface SamlAssertionReplayStore {
  consume(assertionId: string): Promise<void>;
}

/**
 * Drop stored IDs only after SAML NotOnOrAfter would already reject them.
 * 1 hour is longer than typical assertion lifetimes (minutes) plus
 * SamlServiceProvider acceptedClockSkewMs (5000).
 */
const REPLAY_RETENTION_MS = 60 * 60 * 1000;

class InMemorySamlAssertionReplayStore implements SamlAssertionReplayStore {
  private readonly seen = new Map<string, number>();

  async consume(assertionId: string): Promise<void> {
    this.gc();
    const consumedAt = this.seen.get(assertionId);
    if (consumedAt !== undefined && Date.now() - consumedAt < REPLAY_RETENTION_MS) {
      throw new Error("SAML assertion replay detected.");
    }

    this.seen.set(assertionId, Date.now());
  }

  clear(): void {
    this.seen.clear();
  }

  private gc(): void {
    const cutoff = Date.now() - REPLAY_RETENTION_MS;
    for (const [id, at] of this.seen) {
      if (at < cutoff) {
        this.seen.delete(id);
      }
    }
  }
}

type ReplayConnection = Readonly<{
  dialect: SqlDialect;
  execute: (statement: SqlStatement) => Promise<unknown>;
}>;
type ReplayTransaction = (work: (connection: ReplayConnection) => Promise<void>) => Promise<void>;
async function consumeSqlAssertion(run: ReplayTransaction, assertionId: string): Promise<void> {
  try {
    await run(async ({ dialect, execute }) => {
      await execute({
        text: `INSERT INTO auth_saml_assertions (assertion_id, consumed_at) VALUES (${dialect.placeholder(1)}, ${dialect.placeholder(2)})`,
        params: [assertionId, dialect.timestampValue(new Date())],
      });
      await execute({
        text: `DELETE FROM auth_saml_assertions WHERE consumed_at < ${dialect.placeholder(1)}`,
        params: [dialect.timestampValue(new Date(Date.now() - REPLAY_RETENTION_MS))],
      });
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) throw new Error("SAML assertion replay detected.");
    throw error;
  }
}
/** The canonical path receives its exact live invocation selection. */
function createSqlSamlAssertionReplayStore(
  selected: DatabaseSession | TransactionSession,
): SamlAssertionReplayStore {
  return Object.freeze({
    consume: (assertionId: string) =>
      consumeSqlAssertion(
        (work) =>
          selected.transaction((child) =>
            work({ dialect: child.dialect, execute: (statement) => child.execute(statement) }),
          ),
        assertionId,
      ),
  });
}

export type { SamlAssertionReplayStore };
export { createSqlSamlAssertionReplayStore, InMemorySamlAssertionReplayStore, REPLAY_RETENTION_MS };
