/** Private, deliberately shared per-worker fixture; never registers a framework default. */
import { afterAll } from "bun:test";
import { databaseConfig } from "../../src/config/database";
import {
  createDatabaseConnection,
  type DatabaseConnection,
} from "../../src/db/connection/createConnection";

export class FixtureDatabase {
  private current?: DatabaseConnection;
  private replacement?: Promise<DatabaseConnection>;
  private closing?: Promise<void>;
  private cleanupFailure?: { error: unknown };
  constructor(private readonly create: () => DatabaseConnection) {}

  connection(): DatabaseConnection {
    if (this.closing || this.replacement || this.cleanupFailure)
      throw new Error("Fixture database cleanup or replacement is pending or failed.");
    this.current ??= this.create();
    return this.current;
  }
  async ping(connection = this.connection()): Promise<boolean> {
    try {
      await connection`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
  async ensure(): Promise<DatabaseConnection> {
    if (await this.ping()) return this.connection();
    return this.replace(this.create);
  }
  replace(create: () => DatabaseConnection): Promise<DatabaseConnection> {
    if (this.closing || this.replacement)
      return Promise.reject(new Error("Fixture database transition is already active."));
    if (this.cleanupFailure) return Promise.reject(this.cleanupFailure.error);
    const previous = this.current;
    this.replacement = Promise.resolve().then(async () => {
      try {
        if (previous) {
          try {
            await previous.close();
          } catch (error) {
            this.cleanupFailure = { error };
            throw error;
          }
        }
        this.current = undefined;
        const next = create();
        this.current = next;
        return next;
      } finally {
        this.replacement = undefined;
      }
    });
    return this.replacement;
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    if (!this.current && !this.replacement && !this.cleanupFailure) return Promise.resolve();
    const replacement = this.replacement;
    // Closing during replacement joins it and closes its new handle. Mark the
    // close request now so no caller can acquire in the handoff microtask gap.
    this.closing = Promise.resolve().then(async () => {
      try {
        if (replacement) await replacement.catch(() => undefined);
        if (this.cleanupFailure) throw this.cleanupFailure.error;
        const current = this.current;
        if (!current) return;
        try {
          await current.close();
        } catch (error) {
          this.cleanupFailure = { error };
          throw error;
        }
        this.current = undefined;
      } finally {
        this.closing = undefined;
      }
    });
    return this.closing;
  }
}

export const fixtureDatabase = new FixtureDatabase(() => createDatabaseConnection(databaseConfig));
afterAll(() => fixtureDatabase.close());
