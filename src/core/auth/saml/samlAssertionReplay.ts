import { getBoundDatabaseConnection } from "../../database/boundConnection";
import { getDefaultDatabasePool } from "../../database/defaultConnection";
import { currentSqlDialect } from "../../database/dialect";
import { isUniqueConstraintError } from "../../database/errors";

interface SamlAssertionReplayStore {
  consume(assertionId: string): Promise<void>;
}

const REPLAY_TTL_MS = 10 * 60 * 1000;

class InMemorySamlAssertionReplayStore implements SamlAssertionReplayStore {
  private readonly seen = new Map<string, number>();

  constructor(private readonly ttlMs = REPLAY_TTL_MS) {}

  async consume(assertionId: string): Promise<void> {
    const now = Date.now();
    for (const [key, seenAt] of this.seen) {
      if (now - seenAt > this.ttlMs) {
        this.seen.delete(key);
      }
    }

    if (this.seen.has(assertionId)) {
      throw new Error("SAML assertion replay detected.");
    }

    this.seen.set(assertionId, now);
  }

  clear(): void {
    this.seen.clear();
  }
}

class SqlSamlAssertionReplayStore implements SamlAssertionReplayStore {
  async consume(assertionId: string): Promise<void> {
    const sql = getBoundDatabaseConnection() ?? getDefaultDatabasePool();
    const dialect = currentSqlDialect();

    try {
      await sql.unsafe(
        `INSERT INTO auth_saml_assertions (assertion_id) VALUES (${dialect.placeholder(1)})`,
        [assertionId],
      );
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new Error("SAML assertion replay detected.");
      }

      throw error;
    }
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
  resetSamlReplayCacheForTests,
  setSamlAssertionReplayStoreForTests,
};
