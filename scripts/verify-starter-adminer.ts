/** Real generated Compose, isolated projects/ports, and actual Adminer/database login.
 * --published=VERSION uses the exact registry generator, never source substitution. */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const directory = await mkdtemp(join(tmpdir(), "strata-adminer-"));
const published = process.argv.find((arg) => arg.startsWith("--published="))?.slice(12);
if (published && !/^\d+\.\d+\.\d+$/.test(published))
  throw new Error("Exact published version required.");
const selectedDatabase = process.argv.find((arg) => arg.startsWith("--database="))?.slice(11);
assert.ok(
  selectedDatabase === undefined || selectedDatabase === "mysql" || selectedDatabase === "postgres",
  "Choose mysql or postgres.",
);
const databases = selectedDatabase ? [selectedDatabase] : (["mysql", "postgres"] as const);
const projects: Array<{ name: string; app: string }> = [];
const env = { ...process.env, COMPOSE_PROFILES: "" };
async function run(command: string[], cwd = root, timeout = 60000) {
  const child = Bun.spawn(command, { cwd, env, stdout: "pipe", stderr: "pipe", timeout });
  const [code, out, err] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  assert.equal(code, 0, `${command.slice(0, 4).join(" ")} failed: ${err}`);
  return out.trim();
}
function compose(project: { name: string; app: string }, args: string[]) {
  return run(
    [
      "docker",
      "compose",
      "-p",
      project.name,
      "-f",
      "docker-compose.yml",
      "-f",
      "acceptance-ports.yml",
      ...args,
    ],
    project.app,
    args.includes("up") ? 240000 : 120000,
  );
}
let cleanupPromise: Promise<void> | undefined;
function cleanup() {
  cleanupPromise ??= (async () => {
    const failures: unknown[] = [];
    for (const project of projects.toReversed()) {
      try {
        await compose(project, ["--profile", "debug", "down", "--volumes", "--remove-orphans"]);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length)
      throw new AggregateError(
        failures,
        `Owned Compose cleanup failed; files retained at ${directory}`,
      );
    await rm(directory, { recursive: true, force: true });
  })();
  return cleanupPromise;
}
const terminate = () => {
  void cleanup().then(
    () => process.exit(143),
    () => process.exit(1),
  );
};
process.once("SIGTERM", terminate);
try {
  for (const database of databases) {
    const name = `strata-adminer-${crypto.randomUUID().replaceAll("-", "")}`;
    const projectName = `adminer-${database}`;
    const databaseName = projectName.replaceAll("-", "_");
    const app = join(directory, projectName);
    const flags = [
      projectName,
      `--database=${database}`,
      `--docker-services=${database},adminer`,
      "--cache=array",
      "--queue=sync",
      "--mail=log",
      "--yes",
    ];
    const generated = await run(
      published
        ? [process.execPath, "x", "--bun", `create-strata@${published}`, ...flags]
        : [process.execPath, join(root, "packages/strata-starter/cli.ts"), ...flags],
      directory,
    );
    assert.ok(generated.includes("docker compose --profile debug up -d"));
    const readme = await readFile(join(app, "README.md"), "utf8");
    assert.ok(readme.includes("docker compose --profile debug up -d"));
    assert.ok(readme.includes(`database \`${databaseName}\``));
    assert.ok(readme.includes(`server \`${database}\``));
    const password = database === "mysql" ? "dev-mysql-change-me" : "dev-postgres-change-me";
    const username = database === "mysql" ? "root" : "postgres";
    assert.ok(readme.includes(`username \`${username}\`, password \`${password}\``));
    // Keep the generated healthchecks. Only host ports are isolated here.
    await writeFile(
      join(app, "acceptance-ports.yml"),
      `services:\n  ${database}:\n    ports: !override []\n  adminer:\n    ports: !override\n      - "127.0.0.1::8080"\n`,
    );
    const project = { name, app };
    projects.push(project);
    const config = JSON.parse(
      await compose(project, ["--profile", "debug", "config", "--format", "json"]),
    );
    assert.ok(config.services[database].healthcheck.test);
    assert.ok(config.services.adminer.healthcheck.test);
    assert.equal(config.services.adminer.depends_on[database].condition, "service_healthy");
    assert.deepEqual(config.services.adminer.profiles, ["debug"]);
    assert.equal(config.services.adminer.environment.ADMINER_DEFAULT_SERVER, database);
    assert.deepEqual(Object.keys(config.services).sort(), [database, "adminer"].sort());
    await compose(project, ["up", "-d", "--wait", "--wait-timeout", "180"]);
    assert.equal(
      await compose(project, ["ps", "-q", "adminer"]),
      "",
      "Default startup must leave debug tooling stopped.",
    );
    await compose(project, ["--profile", "debug", "up", "-d", "--wait", "--wait-timeout", "180"]);
    assert.ok(await compose(project, ["ps", "-q", "adminer"]));
    const address = await compose(project, ["port", "adminer", "8080"]);
    assert.match(address, /^127\.0\.0\.1:\d+$/);
    const url = `http://${address}/`;
    let cookie = "";
    let loggedIn = false;
    let last = "";
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        const page = await fetch(url, { signal: AbortSignal.timeout(3000) });
        const html = await page.text();
        assert.equal(page.status, 200);
        assert.ok(html.includes("Adminer"));
        cookie = (page.headers.getSetCookie?.() ?? [])
          .map((item) => item.split(";", 1)[0])
          .join("; ");
        const form = new URLSearchParams({
          "auth[driver]": database === "mysql" ? "server" : "pgsql",
          "auth[server]": database,
          "auth[username]": username,
          "auth[password]": password,
          "auth[db]": databaseName,
        });
        const login = await fetch(url, {
          method: "POST",
          redirect: "manual",
          headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
          body: form,
          signal: AbortSignal.timeout(3000),
        });
        last = await login.text();
        if (login.status >= 300 && login.status < 400 && login.headers.has("location")) {
          const cookies = new Map(
            cookie
              .split("; ")
              .filter(Boolean)
              .map((pair) => [pair.slice(0, pair.indexOf("=")), pair]),
          );
          for (const item of login.headers.getSetCookie?.() ?? []) {
            const pair = item.split(";", 1)[0];
            assert.ok(pair);
            cookies.set(pair.slice(0, pair.indexOf("=")), pair);
          }
          const location = login.headers.get("location");
          assert.ok(location);
          const signedIn = await fetch(new URL(location, url), {
            headers: { cookie: [...cookies.values()].join("; ") },
            signal: AbortSignal.timeout(3000),
          });
          last = await signedIn.text();
          loggedIn = signedIn.status === 200 && /name=['"]logout['"]/.test(last);
        }
        if (loggedIn) break;
      } catch (error) {
        last = error instanceof Error ? error.message : String(error);
      }
      await Bun.sleep(500);
    }
    assert.ok(
      loggedIn,
      `Adminer must authenticate with generated ${database} instructions (last response length ${last.length}).`,
    );
    console.log(
      `PASS Adminer ${database}: default/profile startup, loopback port, generated credentials and database login`,
    );
    await compose(project, ["--profile", "debug", "down", "--volumes", "--remove-orphans"]);
    projects.pop();
  }
} finally {
  process.removeListener("SIGTERM", terminate);
  await cleanup();
}
