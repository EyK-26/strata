/** Serial native proof: delayed delivery of a REAL successful MySQL acknowledgement. */
import { test } from "bun:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createConnection } from "mysql2/promise";

const digest = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function deadline<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(label)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
async function capture(
  stream: ReadableStream<Uint8Array>,
  line: (value: string) => void,
): Promise<void> {
  const reader = stream.getReader(),
    decoder = new TextDecoder();
  let pending = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      let end = pending.indexOf("\n");
      while (end >= 0) {
        line(pending.slice(0, end));
        pending = pending.slice(end + 1);
        end = pending.indexOf("\n");
      }
    }
    pending += decoder.decode();
    if (pending) line(pending);
  } finally {
    reader.releaseLock();
  }
}
/** Compare every regular package file to immutable npm-tar bytes, without source aliases. */
async function installedPackages(app: string): Promise<unknown[]> {
  const archiveDirectory = process.env.STRATA_TEST_PACKAGE_DIR;
  assert.ok(archiveDirectory, "Native fixture proof requires immutable candidate archives.");
  const manifest = JSON.parse(await readFile(join(archiveDirectory, "manifest.json"), "utf8"));
  assert.equal(manifest.version, 1);
  assert.equal(manifest.root, await realpath(join(import.meta.dir, "../..")));
  const receipts: unknown[] = [];
  for (const part of ["core", "bootstrap", "cli"]) {
    const archive = manifest.archives[part];
    assert.equal(basename(archive.file), archive.file);
    const packed: Uint8Array<ArrayBuffer> = await readFile(join(archiveDirectory, archive.file));
    assert.equal(digest(packed), archive.sha256);
    assert.equal(
      digest(await readFile(join(import.meta.dir, `../../packages/strata-${part}/package.json`))),
      archive.manifestSha256,
    );
    const tar = Bun.gunzipSync(packed);
    const files: string[] = [];
    for (let offset = 0; offset + 512 <= tar.length; ) {
      const header = tar.subarray(offset, offset + 512);
      if (header.every((byte) => byte === 0)) break;
      const field = (start: number, length: number) =>
        new TextDecoder().decode(header.subarray(start, start + length)).replace(/\0.*$/s, "");
      const size = Number.parseInt(field(124, 12).trim(), 8);
      assert.ok(Number.isSafeInteger(size) && size >= 0);
      const prefix = field(345, 155),
        name = field(0, 100),
        path = prefix ? `${prefix}/${name}` : name;
      const type = field(156, 1);
      if (type === "0" || type === "") {
        assert.ok(path.startsWith("package/") && !path.split("/").includes(".."));
        const relative = path.slice(8),
          bytes = tar.subarray(offset + 512, offset + 512 + size);
        const installed = await readFile(join(app, "node_modules", `@getstrata/${part}`, relative));
        assert.equal(
          digest(installed),
          digest(bytes),
          `Installed ${part}/${relative} must match its archive.`,
        );
        files.push(`${relative}:${digest(installed)}`);
      }
      offset += 512 + Math.ceil(size / 512) * 512;
    }
    assert.ok(files.length > 5, "Inspect actual installed packages, not only their manifests.");
    receipts.push({
      part,
      archiveSha256: archive.sha256,
      files: files.length,
      installedSha256: digest(files.sort().join("\n")),
    });
  }
  return receipts;
}

test("generated fixture joins cancelled pre-return MySQL acquisition and reconciles exact native resources", async () => {
  const mysqlUrl = process.env.MYSQL_OBSERVABILITY_ADMIN_URL;
  assert.ok(mysqlUrl, "Owned MySQL admin URL required.");
  assert.equal(new URL(mysqlUrl).protocol, "mysql:");
  assert.ok(process.env.STRATA_TEST_PACKAGE_DIR, "Use the immutable installed candidate set.");
  const errors: unknown[] = [];
  let parent: string | undefined, control: Awaited<ReturnType<typeof createConnection>> | undefined;
  let child: ReturnType<typeof Bun.spawn<"pipe", "pipe", "pipe">> | undefined;
  let observation: Promise<PromiseSettledResult<unknown>[]> | undefined;
  let terminal: PromiseSettledResult<number> | undefined;
  let released = false,
    observationsSettled = false,
    forced = false;
  let databaseName: string | undefined, mysqlUser: string | undefined, root: string | undefined;
  let stderr = "";
  const events: Record<string, unknown>[] = [];
  const held = deferred<Record<string, unknown>>(),
    cancelled = deferred<void>();
  const release = () => {
    if (!child || released) return;
    released = true;
    child.stdin.write("release\n");
    child.stdin.end();
  };
  const stop = () => {
    try {
      release();
    } catch (error) {
      errors.push(error);
    }
    try {
      if (child && terminal?.status !== "fulfilled") child.kill("SIGTERM");
    } catch (error) {
      errors.push(error);
    }
  };
  process.once("SIGTERM", stop);
  try {
    parent = await mkdtemp(join(tmpdir(), "strata-security-owner-proof-"));
    control = await createConnection(mysqlUrl);
    child = Bun.spawn(
      [
        process.execPath,
        join(import.meta.dir, "../fixtures/generatedSecurityAppOwnerConsumer.ts"),
        parent,
      ],
      {
        cwd: join(import.meta.dir, "../.."),
        env: process.env,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const exited = child.exited.then(
      (code) => {
        terminal = { status: "fulfilled", value: code };
        return code;
      },
      (reason) => {
        terminal = { status: "rejected", reason };
        throw reason;
      },
    );
    const output = capture(child.stdout, (line) => {
      if (!line.startsWith("{")) return;
      const record: unknown = JSON.parse(line);
      assert.ok(record && typeof record === "object" && "event" in record);
      events.push(record as Record<string, unknown>);
      if (record.event === "successful-result-held")
        held.resolve(record as Record<string, unknown>);
      if (record.event === "cancel-observed") cancelled.resolve();
    });
    observation = Promise.allSettled([
      exited,
      output,
      new Response(child.stderr).text().then((value) => {
        stderr = value;
      }),
    ]);
    const barrier = await deadline(
      Promise.race([
        held.promise,
        exited.then(() => {
          throw new Error("Native child exited before its held-result boundary.");
        }),
      ]),
      90000,
      "Native held-result boundary deadline exceeded.",
    );
    assert.equal(typeof barrier.databaseName, "string");
    assert.equal(typeof barrier.mysqlUser, "string");
    assert.equal(typeof barrier.root, "string");
    const ownedDatabase = barrier.databaseName as string;
    const ownedUser = barrier.mysqlUser as string;
    const ownedRoot = barrier.root as string;
    assert.match(ownedDatabase, /^generated_security_[a-f0-9]{32}$/);
    assert.match(ownedUser, /^q01_[a-f0-9]{18}$/);
    assert.equal(dirname(resolve(ownedRoot)), resolve(parent));
    assert.match(basename(ownedRoot), /^strata-security-/);
    databaseName = ownedDatabase;
    mysqlUser = ownedUser;
    root = ownedRoot;
    assert.ok(existsSync(root));
    const [databases] = await control.query(
      "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?",
      [databaseName],
    );
    const [users] = await control.query(
      "SELECT User FROM mysql.user WHERE User = ? AND Host = '%'",
      [mysqlUser],
    );
    assert.ok(
      Array.isArray(databases) && databases.length === 1,
      "The exact actual database must exist before SIGTERM.",
    );
    assert.ok(
      Array.isArray(users) && users.length === 1,
      "The exact actual user must exist before SIGTERM.",
    );
    const installed = await installedPackages(join(root, "app"));
    console.log(
      JSON.stringify({
        generatedFixtureNativeBoundary: "successful CREATE USER result delivery held",
        databaseName,
        mysqlUser,
        root,
        installed,
      }),
    );
    assert.equal(terminal, undefined, "Helper must still be awaiting acquisition.");
    assert.ok(
      !events.some(
        (event) => event.event === "unexpected-ready" || event.event === "grant-admitted",
      ),
    );
    child.kill("SIGTERM");
    await deadline(
      Promise.race([
        cancelled.promise,
        exited.then(() => {
          throw new Error("Native child exited before cancellation observation.");
        }),
      ]),
      10000,
      "Cancellation observation deadline exceeded.",
    );
    assert.ok(existsSync(root), "Do not remove the directory under a held native acquisition.");
    release();
    const results = await deadline(observation, 30000, "Native cancellation did not join.");
    for (const result of results) if (result.status === "rejected") errors.push(result.reason);
    observationsSettled = true;
    assert.equal(results[0]?.status, "fulfilled");
    if (results[0]?.status === "fulfilled")
      assert.equal(results[0].value, 143, "Child must unwind its owned cancellation.");
    const order = events.map((event) => event.event);
    assert.deepEqual(order, [
      "successful-result-held",
      "cancel-observed",
      "successful-result-released",
      "setup-rejected",
    ]);
    assert.equal(
      events.find((event) => event.event === "setup-rejected")?.expectedCancellation,
      true,
      "Only the exact helper interruption, without cleanup failures, is expected cancellation.",
    );
    const [afterDatabases] = await control.query(
      "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?",
      [databaseName],
    );
    const [afterUsers] = await control.query(
      "SELECT User FROM mysql.user WHERE User = ? AND Host = '%'",
      [mysqlUser],
    );
    assert.ok(
      Array.isArray(afterDatabases) && afterDatabases.length === 0,
      "Helper must remove its exact database before parent fallback.",
    );
    assert.ok(
      Array.isArray(afterUsers) && afterUsers.length === 0,
      "Helper must remove its exact user before parent fallback.",
    );
    assert.equal(existsSync(root), false);
    assert.deepEqual(await readdir(parent), []);
    console.log(
      JSON.stringify({
        generatedFixtureNativeCleanup: {
          databaseName,
          mysqlUser,
          root,
          absent: true,
          events: order,
          stderrBytes: stderr.length,
          stderrSha256: digest(stderr),
        },
      }),
    );
  } catch (error) {
    errors.push(error);
  } finally {
    try {
      release();
    } catch (error) {
      errors.push(error);
    }
    if (child && observation && (!observationsSettled || terminal?.status !== "fulfilled")) {
      try {
        if (terminal?.status !== "fulfilled") child.kill("SIGTERM");
        const results = await deadline(
          observation,
          10000,
          "Native child fallback join deadline exceeded.",
        );
        if (!observationsSettled)
          for (const result of results)
            if (result.status === "rejected") errors.push(result.reason);
        observationsSettled = true;
      } catch (error) {
        errors.push(error);
        forced = true;
        try {
          child.kill("SIGKILL");
        } catch (failure) {
          errors.push(failure);
        }
        try {
          const results = await deadline(
            observation,
            10000,
            "Forced native child could not be joined.",
          );
          if (!observationsSettled)
            for (const result of results)
              if (result.status === "rejected") errors.push(result.reason);
          observationsSettled = true;
        } catch (failure) {
          errors.push(failure);
        }
      }
    }
    if (forced) errors.push(new Error("Forced kill invalidates the graceful cancellation proof."));
    const destructiveCleanupSafe =
      !child || (observationsSettled && terminal?.status === "fulfilled");
    // Fallback cleanup never supplies the preceding helper-absence assertion.
    if (destructiveCleanupSafe && control) {
      if (mysqlUser)
        try {
          await control.query(`DROP USER IF EXISTS '${mysqlUser}'@'%'`);
        } catch (error) {
          errors.push(error);
        }
      if (databaseName)
        try {
          await control.query(`DROP DATABASE IF EXISTS ${databaseName}`);
        } catch (error) {
          errors.push(error);
        }
    }
    if (control)
      try {
        await control.end();
      } catch (error) {
        errors.push(error);
      }
    if (parent && destructiveCleanupSafe)
      try {
        await rm(parent, { recursive: true, force: true });
      } catch (error) {
        errors.push(error);
      }
    if (child && !destructiveCleanupSafe)
      errors.push(
        new Error(
          `Native child PID ${child.pid} termination remains unconfirmed; root ${root ?? parent ?? "(not acquired)"} and native resources ${databaseName ?? "(unknown)"}/${mysqlUser ?? "(unknown)"} retained.`,
        ),
      );
    process.removeListener("SIGTERM", stop);
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1)
    throw new AggregateError(
      errors,
      "Generated fixture native cancellation proof and cleanup failed.",
    );
}, 180000);
