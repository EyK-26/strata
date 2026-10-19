/** Literal generated onboarding: owned empty volumes, port-only overrides, no readiness retries. */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { replaceFixtureLoopbackPort } from "../tests/helpers/fixtureLoopbackPort";

const repo = join(import.meta.dir, "..");
const database = process.argv.find((arg) => arg.startsWith("--database="))?.slice(11);
assert.ok(database === "mysql" || database === "postgres" || database === "sqlite");
const published = process.argv.find((arg) => arg.startsWith("--published="))?.slice(12);
assert.ok(!published || /^\d+\.\d+\.\d+$/.test(published));
const root = await mkdtemp(join(tmpdir(), "strata-ready-"));
const name = `ready-${database}`,
  app = join(root, name);
const project = `strata-ready-${crypto.randomUUID().replaceAll("-", "")}`;
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) =>
    ["PATH", "HOME", "TMPDIR", "USER", "SHELL"].includes(key),
  ),
);
let composeCreated = false;
const ownedVolumes = new Set<string>();
async function rememberOwnedVolumes() {
  const ids = (await compose(["ps", "--all", "-q"])).split(/\s+/).filter(Boolean);
  for (const id of ids) {
    const [container] = JSON.parse(await command(["docker", "inspect", id]));
    assert.equal(container.Config.Labels["com.docker.compose.project"], project);
    for (const mount of container.Mounts) {
      if (mount.Type === "volume") ownedVolumes.add(mount.Name);
    }
  }
}
let server: ReturnType<typeof Bun.spawn> | undefined;
async function command(args: string[], cwd = app, expected = 0, timeout = 180000) {
  const child = Bun.spawn(args, { cwd, env, stdout: "pipe", stderr: "pipe", timeout });
  const [code, out, err] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (expected === 0) assert.equal(code, 0, `${args.slice(0, 4).join(" ")} failed: ${err}`);
  else assert.notEqual(code, 0, "Unhealthy dependency must reject onboarding.");
  return out.trim();
}
function compose(args: string[], extra: string[] = [], expected = 0) {
  return command(
    [
      "docker",
      "compose",
      "-p",
      project,
      "-f",
      "docker-compose.yml",
      "-f",
      "ports.yml",
      ...extra,
      ...args,
    ],
    app,
    expected,
  );
}
let cleanupPromise: Promise<void> | undefined;
function cleanup() {
  cleanupPromise ??= (async () => {
    if (server) {
      server.kill("SIGTERM");
      await server.exited;
    }
    if (composeCreated) {
      await rememberOwnedVolumes();
      await compose(["--profile", "debug", "down", "--volumes", "--remove-orphans"]);
    }
    // Compose removes the current anonymous mounts, but service recreation can
    // leave an earlier anonymous Redis volume behind. Remove only mount IDs
    // captured from this owned project, and refuse to touch any mounted volume.
    const present = new Set(
      (await command(["docker", "volume", "ls", "--format", "{{.Name}}"], repo)).split(/\s+/),
    );
    for (const name of ownedVolumes) {
      if (!present.has(name)) continue;
      const users = await command(
        ["docker", "ps", "--all", "--filter", `volume=${name}`, "--format", "{{.ID}}"],
        repo,
      );
      assert.equal(users, "", "An owned fixture volume must be unused before removal");
      await command(["docker", "volume", "rm", name], repo);
    }
    await rm(root, { recursive: true, force: true });
    const remaining = new Set(
      (await command(["docker", "volume", "ls", "--format", "{{.Name}}"], repo)).split(/\s+/),
    );
    assert.deepEqual(
      [...ownedVolumes].filter((name) => remaining.has(name)),
      [],
      "Owned fixture volumes must be removed, including volumes left by service recreation",
    );
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
  const generated = await command(
    [
      process.execPath,
      ...(published
        ? ["x", "--bun", `create-strata@${published}`]
        : [join(repo, "packages/strata-starter/cli.ts")]),
      name,
      "--yes",
      "--frontend=server-htmx",
      `--database=${database}`,
      "--auth=cookie",
      "--tenancy=none",
      "--cache=redis",
      "--queue=redis",
      "--mail=smtp",
      "--docker",
    ],
    root,
  );
  const readme = await readFile(join(app, "README.md"), "utf8");
  const startup = "docker compose up -d --wait --wait-timeout 180";
  assert.ok(generated.includes(startup));
  assert.ok(readme.includes(startup));
  const services = [...(database === "sqlite" ? [] : [database]), "redis", "mailpit"];
  const ports = { mysql: [3306], postgres: [5432], redis: [6379], mailpit: [1025, 8025] };
  await writeFile(
    join(app, "ports.yml"),
    `services:\n${services.map((service) => `  ${service}:\n    ports: !override\n${ports[service as keyof typeof ports].map((port) => `      - "127.0.0.1::${port}"`).join("\n")}`).join("\n")}\n`,
  );
  composeCreated = true;
  const config = JSON.parse(await compose(["config", "--format", "json"]));
  assert.deepEqual(Object.keys(config.services).sort(), [...services].sort());
  for (const service of services)
    assert.ok(
      config.services[service].healthcheck.test,
      `Generated ${service} must have its own real readiness check.`,
    );
  // Run exactly the emitted startup options. No healthcheck override or retry precedes migration.
  await compose(startup.split(" ").slice(2));
  for (const service of services) {
    const id = await compose(["ps", "-q", service]);
    assert.ok(id);
    assert.equal(
      await command(["docker", "inspect", "--format", "{{.State.Health.Status}}", id]),
      "healthy",
    );
  }
  await rememberOwnedVolumes();
  let text = await readFile(join(app, ".env.example"), "utf8");
  for (const service of services)
    for (const port of ports[service as keyof typeof ports]) {
      const address = await compose(["port", service, String(port)]);
      assert.match(address, /^127\.0\.0\.1:\d+$/);
      const hostPort = address.split(":").at(-1);
      assert.ok(hostPort);
      text = replaceFixtureLoopbackPort(text, port, hostPort);
      if (service === "mailpit" && port === 1025)
        text = text.replace(/^MAIL_PORT=.*$/m, `MAIL_PORT=${hostPort}`);
    }
  const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const origin = `http://127.0.0.1:${reservation.port}`;
  const port = reservation.port;
  await reservation.stop(true);
  text = text.replace(/^PORT=.*$/m, `PORT=${port}`).replace(/^APP_URL=.*$/m, `APP_URL=${origin}`);
  await writeFile(join(app, ".env"), text);
  const manifest = JSON.parse(await readFile(join(app, "package.json"), "utf8"));
  for (const part of ["core", "bootstrap", "cli"]) {
    if (published) manifest.dependencies[`@getstrata/${part}`] = published;
    else {
      const packed = await command(
        ["npm", "pack", "--silent", "--pack-destination", root],
        join(repo, `packages/strata-${part}`),
      );
      const filename = packed.split("\n").at(-1);
      assert.ok(filename);
      manifest.dependencies[`@getstrata/${part}`] = `file:${join(root, filename)}`;
    }
  }
  await writeFile(join(app, "package.json"), JSON.stringify(manifest));
  await command([process.execPath, "install"]);
  if (published)
    for (const part of ["core", "bootstrap", "cli"])
      assert.equal(
        JSON.parse(
          await readFile(join(app, `node_modules/@getstrata/${part}/package.json`), "utf8"),
        ).version,
        published,
      );
  await command([process.execPath, "run", "db:migrate"]);
  await command([process.execPath, "run", "db:migrate"]);
  server = Bun.spawn([process.execPath, "run", "start"], {
    cwd: app,
    env,
    stdout: Bun.file(join(root, "server.log")),
    stderr: Bun.file(join(root, "server-error.log")),
  });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      ready = (await fetch(`${origin}/health`, { signal: AbortSignal.timeout(2000) })).ok;
    } catch {}
    if (ready) break;
    await Bun.sleep(100);
  }
  assert.ok(ready, "Generated HTTP must serve after its first migration.");
  assert.equal((await fetch(`${origin}/register`)).status, 200);
  server.kill("SIGTERM");
  assert.equal(await server.exited, 0);
  server = undefined;
  await writeFile(
    join(app, "unhealthy.yml"),
    'services:\n  redis:\n    healthcheck:\n      test: ["CMD", "false"]\n      interval: 1s\n      retries: 1\n      start_period: 0s\n',
  );
  await compose(["up", "-d", "--wait", "--wait-timeout", "5"], ["-f", "unhealthy.yml"], 1);
  console.log(
    `PASS ${database}: generated healthy dependencies, first/repeated migration, HTTP and unhealthy-service refusal`,
  );
} finally {
  process.removeListener("SIGTERM", terminate);
  await cleanup();
}
