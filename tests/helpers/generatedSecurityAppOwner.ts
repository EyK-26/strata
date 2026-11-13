/** Private owner for the generated-security fixture; not an application lifecycle API. */
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { CandidatePackageOwnershipError } from "../../scripts/candidate-packages";

type Acquisition = "not-attempted" | "attempted" | "acquired" | "absent";
type PgControl = {
  unsafe(text: string, values?: unknown[]): PromiseLike<unknown>;
  close(): unknown;
};
type MysqlControl = {
  query(text: string, values?: unknown[]): Promise<unknown>;
  end(): Promise<void>;
};
type Child = ReturnType<typeof Bun.spawn<"ignore", "pipe", "pipe">>;
function throwErrors(errors: unknown[], message: string): void {
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, message);
}

export class GeneratedSecurityAppOwner {
  root?: string;
  postgres?: PgControl;
  mysql?: MysqlControl;
  connectionAttempted = false;
  database: Acquisition = "not-attempted";
  user: Acquisition = "not-attempted";
  private readonly cancellation = new AbortController();
  private readonly interruption = new Error("Generated security setup interrupted by SIGTERM.");
  private readonly errors: unknown[] = [];
  private setupSettled: Promise<unknown> = Promise.resolve();
  private child?: Child;
  private childObservation?: Promise<PromiseSettledResult<unknown>[]>;
  private childUncertainty?: AggregateError;
  private packUncertainty?: CandidatePackageOwnershipError;
  private childTimer?: ReturnType<typeof setTimeout>;
  private closing = false;
  private closed?: Promise<void>;
  private readonly terminate = () => {
    process.exitCode = 143;
    this.cancel();
  };

  constructor(
    readonly databaseName: string,
    readonly mysqlUser: string,
  ) {
    assert.match(databaseName, /^generated_security_[a-f0-9]{32}$/);
    assert.match(mysqlUser, /^q01_[a-f0-9]{18}$/);
    process.once("SIGTERM", this.terminate);
  }
  admit(): void {
    if (this.childUncertainty || this.packUncertainty)
      throw new Error("Generated fixture child termination is unconfirmed; admission refused.");
    if (this.cancellation.signal.aborted) throw this.cancellation.signal.reason;
    if (this.closing) throw new Error("Generated security fixture is closing.");
  }
  cancel(): void {
    this.cancellation.abort(this.interruption);
    const child = this.child;
    if (!child) return;
    try {
      child.kill("SIGTERM");
    } catch (error) {
      this.errors.push(error);
    }
    this.childTimer ??= setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch (error) {
        this.errors.push(error);
      }
      this.errors.push(new Error("Generated fixture child required forced SIGKILL."));
    }, 10000);
  }
  observeSetup<T>(setup: Promise<T>): Promise<T> {
    // This observation never rejects; failSetup retains the original rejection separately.
    this.setupSettled = setup.then(
      () => undefined,
      (error) => {
        if (error instanceof CandidatePackageOwnershipError) this.packUncertainty = error;
      },
    );
    return setup;
  }
  handoff(): void {
    this.admit();
    // No await between the final cancellation check and listener removal.
    process.removeListener("SIGTERM", this.terminate);
  }
  async runChild(args: string[], cwd: string, timeout: number): Promise<void> {
    this.admit();
    const child = Bun.spawn(args, {
      cwd,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout,
      killSignal: "SIGKILL",
    });
    this.child = child;
    let confirmed = false;
    try {
      const exited = child.exited.catch((reason) => {
        try {
          child.kill("SIGTERM");
        } catch (error) {
          this.errors.push(error);
        }
        throw reason;
      });
      const observation = Promise.allSettled([
        exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ] as const);
      this.childObservation = observation;
      const results = await observation;
      const errors = results.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : [],
      );
      const [terminal, out, err] = results;
      confirmed = terminal.status === "fulfilled";
      const output =
        (out.status === "fulfilled" ? out.value : "") +
        (err.status === "fulfilled" ? err.value : "");
      if (terminal.status === "fulfilled")
        try {
          assert.equal(terminal.value, 0, `Generated fixture child failed:\n${output}`);
        } catch (error) {
          errors.push(error);
        }
      if (this.cancellation.signal.aborted) errors.unshift(this.cancellation.signal.reason);
      throwErrors(errors, "Generated fixture child and observers failed.");
    } catch (error) {
      if (!confirmed) {
        this.childUncertainty = new AggregateError(
          [error],
          `Unresolved generated fixture child PID ${child.pid}; root ${this.root ?? "(not acquired)"} retained.`,
        );
        throw this.childUncertainty;
      }
      throw error;
    } finally {
      if (this.childTimer) clearTimeout(this.childTimer);
      this.childTimer = undefined;
      // Stream settlement or a kill request cannot substitute for a terminal acknowledgement.
      if (confirmed) {
        this.child = undefined;
        this.childObservation = undefined;
      }
    }
  }

  // Non-async: repeated callers receive the exact same promise, including rejection.
  close = (): Promise<void> => (this.closed ??= this.cleanup());
  async failSetup(primary: unknown): Promise<never> {
    try {
      await this.close();
    } catch {
      /* cleanup records every failure in order */
    }
    throwErrors([primary, ...this.errors], "Generated security setup and cleanup failed.");
    throw new Error("Unreachable");
  }
  private async cleanup(): Promise<void> {
    this.closing = true;
    await this.setupSettled;
    if (this.childObservation) await this.childObservation;
    const attempt = async (work: () => unknown): Promise<void> => {
      try {
        await work();
      } catch (error) {
        this.errors.push(error);
      }
    };
    try {
      const mysql = this.mysql,
        postgres = this.postgres;
      const unsafe = this.childUncertainty !== undefined || this.packUncertainty !== undefined;
      if (unsafe) {
        if (this.childUncertainty) {
          this.errors.push(this.childUncertainty);
          const child = this.child;
          if (child) await attempt(() => child.kill("SIGTERM"));
        }
        if (this.packUncertainty) {
          this.errors.push(this.packUncertainty);
          await attempt(() => this.packUncertainty?.requestStop());
        }
        this.errors.push(
          new Error(
            `Generated fixture root/native resources retained under unconfirmed child: ${this.root ?? "(not acquired)"}`,
          ),
        );
      }
      if (!unsafe) {
        if (this.user !== "not-attempted" && this.user !== "absent") {
          if (mysql) {
            await attempt(() => mysql.query(`DROP USER IF EXISTS '${this.mysqlUser}'@'%'`));
            await attempt(async () => {
              const result = await mysql.query(
                "SELECT User FROM mysql.user WHERE User = ? AND Host = '%'",
                [this.mysqlUser],
              );
              assert.ok(
                Array.isArray(result) && Array.isArray(result[0]),
                "Malformed MySQL user absence result.",
              );
              assert.equal(result[0].length, 0, "Owned MySQL user remains present.");
              this.user = "absent";
            });
          }
          if ((this.user as Acquisition) !== "absent")
            this.errors.push(new Error(`Unresolved generated fixture user: ${this.mysqlUser}`));
        }
        if (this.database !== "not-attempted" && this.database !== "absent") {
          if (postgres) {
            await attempt(() =>
              postgres.unsafe(`DROP DATABASE IF EXISTS ${this.databaseName} WITH (FORCE)`),
            );
            await attempt(async () => {
              const rows = await postgres.unsafe(
                "SELECT datname FROM pg_database WHERE datname = $1",
                [this.databaseName],
              );
              assert.ok(Array.isArray(rows), "Malformed PostgreSQL database absence result.");
              assert.equal(rows.length, 0, "Owned PostgreSQL database remains present.");
              this.database = "absent";
            });
          }
          if (mysql) {
            await attempt(() => mysql.query(`DROP DATABASE IF EXISTS ${this.databaseName}`));
            await attempt(async () => {
              const result = await mysql.query(
                "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?",
                [this.databaseName],
              );
              assert.ok(
                Array.isArray(result) && Array.isArray(result[0]),
                "Malformed MySQL database absence result.",
              );
              assert.equal(result[0].length, 0, "Owned MySQL database remains present.");
              this.database = "absent";
            });
          }
          if ((this.database as Acquisition) !== "absent")
            this.errors.push(
              new Error(`Unresolved generated fixture database: ${this.databaseName}`),
            );
        }
      }
      if (this.connectionAttempted && !postgres && !mysql)
        this.errors.push(
          new Error(
            "Unresolved generated fixture control connection: acquisition returned no handle.",
          ),
        );
      if (postgres) await attempt(() => postgres.close());
      if (mysql) await attempt(() => mysql.end());
      if (!unsafe && this.root)
        await attempt(() => rm(this.root as string, { recursive: true, force: true }));
    } finally {
      if (this.childTimer) clearTimeout(this.childTimer);
      this.childTimer = undefined;
      process.removeListener("SIGTERM", this.terminate);
    }
    throwErrors(this.errors, "Generated security fixture cleanup failed.");
  }
}
