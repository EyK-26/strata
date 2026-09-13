import { getBoundDatabaseConnection } from "../../database/boundConnection";
import { getDefaultDatabasePool } from "../../database/defaultConnection";
import { currentSqlDialect } from "../../database/dialect";
import { isUniqueConstraintError } from "../../database/errors";

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

class SqlSamlAssertionReplayStore implements SamlAssertionReplayStore {
  async consume(assertionId: string): Promise<void> {
    const sql = getBoundDatabaseConnection() ?? getDefaultDatabasePool();
    const dialect = currentSqlDialect();

    try {
      await sql.unsafe(
        `INSERT INTO auth_saml_assertions (assertion_id, consumed_at) VALUES (${dialect.placeholder(1)}, ${dialect.placeholder(2)})`,
        [assertionId, new Date().toISOString()],
      );
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new Error("SAML assertion replay detected.");
      }

      throw error;
    }

    await sql.unsafe(
      `DELETE FROM auth_saml_assertions WHERE consumed_at < ${dialect.placeholder(1)}`,
      [new Date(Date.now() - REPLAY_RETENTION_MS).toISOString()],
    );
  }
}

const sqlReplayStore = new SqlSamlAssertionReplayStore();
let replayStoreOverride: SamlAssertionReplayStore | null = null;

function samlAssertionReplayStore(): SamlAssertionReplayStore {
  return replayStoreOverride ?? sqlReplayStore;
}

function setSamlAssertionReplayStoreForTests(store: SamlAssertionReplayStore | null): void {
  replayStoreOverride = store;
}

function resetSamlReplayCacheForTests(): void {
  if (replayStoreOverride instanceof InMemorySamlAssertionReplayStore) {
    replayStoreOverride.clear();
    return;
  }

  replayStoreOverride = null;
}

async function consumeSamlAssertion(assertionId: string): Promise<void> {
  await samlAssertionReplayStore().consume(assertionId);
}

export type { SamlAssertionReplayStore };
export {
  consumeSamlAssertion,
  InMemorySamlAssertionReplayStore,
  REPLAY_RETENTION_MS,
  resetSamlReplayCacheForTests,
  setSamlAssertionReplayStoreForTests,
};
