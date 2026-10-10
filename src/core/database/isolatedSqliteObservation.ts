import type { DatabaseConnection } from "./baseRepository";

// An isolated CLI process keeps synchronous SQLite I/O off the request event loop.
// Builtins only; env files and inherited application credentials are not loaded.
const childSource = `
import { Database } from 'bun:sqlite';
let db;
process.on('message', message => {
  try {
    if (message.init) {
      db = new Database(message.filename, { readonly: true, create: false });
      db.exec('PRAGMA busy_timeout = 0');
      db.exec('PRAGMA query_only = ON');
      db.exec('BEGIN');
      process.send({ ok: true, rows: [] });
    } else {
      const rows = db.query(message.query).all(...message.params);
      process.send({ ok: true, rows });
    }
  } catch {
    // No SQL, file paths, payloads or driver exception text crosses the error channel.
    process.send({ ok: false });
  }
});
`;

interface ReadOnlyObservationOptions {
  signal: AbortSignal;
  timeoutMs: number;
}
async function observeSqliteReadOnly<T>(
  filename: string,
  operation: (connection: DatabaseConnection) => Promise<T>,
  options: ReadOnlyObservationOptions,
): Promise<T> {
  options.signal.throwIfAborted();
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 5000)
    throw new TypeError("SQL observation timeout must be between 1 and 5000 milliseconds.");
  const executable = Bun.which("bun", { PATH: process.env.PATH ?? "" });
  if (!executable) throw new Error("SQL observations require the Bun CLI on PATH.");
  let pending: { resolve(rows: unknown[]): void; reject(error: unknown): void } | undefined;
  let stopped = false;
  const { promise: aborted, reject: rejectAbort } = Promise.withResolvers<never>();
  const fail = (error: unknown) => {
    pending?.reject(error);
    pending = undefined;
  };
  const child = Bun.spawn({
    cmd: [executable, "--no-env-file", "-e", childSource],
    env: {},
    stdout: "ignore",
    stderr: "ignore",
    serialization: "advanced",
    ipc(message) {
      const response = message as { ok?: boolean; rows?: unknown[] };
      const request = pending;
      pending = undefined;
      if (response?.ok === true && Array.isArray(response.rows)) request?.resolve(response.rows);
      else request?.reject(new Error("Read-only SQL observation failed."));
    },
  });
  const exited = child.exited.then(() => {
    fail(new Error("SQL observation process exited."));
  });
  const abort = (reason: unknown) => {
    stopped = true;
    child.kill("SIGKILL");
    fail(reason);
    rejectAbort(reason);
  };
  const onAbort = () => abort(options.signal.reason);
  options.signal.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => abort(new Error("SQL observation timed out.")), options.timeoutMs);
  const request = (message: object): Promise<unknown[]> => {
    if (stopped) return Promise.reject(new Error("SQL observation is closed."));
    if (pending)
      return Promise.reject(new Error("Concurrent SQL observation queries are not supported."));
    return new Promise((resolve, reject) => {
      pending = { resolve, reject };
      child.send(message);
    });
  };
  try {
    if (options.signal.aborted) onAbort();
    const work = (async () => {
      await request({ init: true, filename });
      options.signal.throwIfAborted();
      return operation({
        async unsafe<TValue>(query: string, params: readonly unknown[] = []) {
          return (await request({
            query,
            params: params.map((value) => (value instanceof Date ? value.toISOString() : value)),
          })) as TValue[];
        },
      });
    })();
    return await Promise.race([work, aborted]);
  } finally {
    stopped = true;
    clearTimeout(timer);
    options.signal.removeEventListener("abort", onAbort);
    child.kill("SIGKILL");
    fail(new Error("SQL observation is closed."));
    await exited;
  }
}

export type { ReadOnlyObservationOptions };
export { observeSqliteReadOnly };
