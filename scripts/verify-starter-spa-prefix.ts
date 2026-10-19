/** Real generated frontend scripts, built assets and native Bun dev/preview servers. */
import assert from "node:assert/strict";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { createGeneratedSecurityApp } from "../tests/helpers/generatedSecurityApp";

const frontend = process.argv.find((arg) => arg.startsWith("--frontend="))?.slice(11);
const rawPrefix = process.argv.find((arg) => arg.startsWith("--prefix="))?.slice(9);
assert.ok(frontend === "spa-react" || frontend === "hybrid");
assert.ok(rawPrefix);
assert.ok(rawPrefix.startsWith("/"));
const prefix = rawPrefix;
const publishedVersion = process.argv.find((arg) => arg.startsWith("--published="))?.slice(12);
const fixture = await createGeneratedSecurityApp(
  "sqlite",
  [
    `--frontend=${frontend}`,
    `--spa-prefix=${prefix}`,
    "--auth=cookie",
    "--tenancy=none",
    "--cache=array",
    "--queue=sync",
    "--mail=log",
    "--no-docker",
    "--no-mfa",
    "--no-email-verification",
    "--no-scim",
    "--no-metrics",
  ],
  { publishedVersion },
);
const marker = `server-secret-${crypto.randomUUID()}`;
const env = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      ["PATH", "HOME", "TMPDIR", "USER", "SHELL"].includes(key),
    ),
  ),
  APP_ENV: "local",
  DATABASE_URL: fixture.runtimeUrl,
  APP_DATABASE_URL: fixture.runtimeUrl,
  TENANCY_DRIVER: "none",
  SESSION_SECRET: marker,
  SPA_PREFIX: prefix,
  OTEL_SDK_DISABLED: "true",
};
await writeFile(
  join(fixture.app, ".env"),
  await readFile(join(fixture.app, ".env.example"), "utf8"),
);
const dockerImage = process.argv.includes("--docker")
  ? `strata-spa-prefix:${crypto.randomUUID()}`
  : undefined;
let dockerBuilt = false;
const children = new Set<ReturnType<typeof Bun.spawn>>();
async function command(args: string[], cwd = fixture.app) {
  const child = Bun.spawn([process.execPath, ...args], {
    cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 90000,
  });
  const [code, out, err] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  assert.equal(code, 0, out + err);
  return out;
}
async function port() {
  const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const value = reservation.port;
  await reservation.stop(true);
  return value;
}
async function stop(child: ReturnType<typeof Bun.spawn>) {
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
  await child.exited;
  children.delete(child);
}
async function start(args: string[], extra: Record<string, string>, label: string) {
  const child = Bun.spawn([process.execPath, ...args], {
    cwd: fixture.app,
    env: { ...env, ...extra },
    detached: true,
    stdout: Bun.file(join(fixture.app, `${label}.log`)),
    stderr: Bun.file(join(fixture.app, `${label}.error.log`)),
  });
  children.add(child);
  return child;
}
async function ready(url: string) {
  let diagnostic = "No HTTP response";
  for (let n = 0; n < 100; n++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return;
      diagnostic = `${response.status}: ${(await response.text()).slice(0, 300)}`;
    } catch {}
    await Bun.sleep(100);
  }
  for (const label of ["backend", "dev", "preview"]) {
    const log = Bun.file(join(fixture.app, `${label}.log`));
    const errors = Bun.file(join(fixture.app, `${label}.error.log`));
    if (await log.exists()) console.error((await log.text()).replaceAll(marker, "[redacted]"));
    if (await errors.exists())
      console.error((await errors.text()).replaceAll(marker, "[redacted]"));
  }
  throw new Error(`Owned frontend/backend did not become ready: ${url}: ${diagnostic}`);
}
async function document(origin: string, path: string, production: boolean) {
  const response = await fetch(origin + path);
  assert.equal(response.status, 200, `${path} must serve its actual document`);
  const html = await response.text();
  assert.ok(html.includes('id="root"'));
  const urls = [...html.matchAll(/(?:src|href)="([^"#]+\.(?:js|css)(?:\?[^" ]*)?)"/g)].map(
    (match) => {
      assert.ok(match[1]);
      return match[1];
    },
  );
  assert.ok(urls.some((url) => url.includes(".js")));
  let js = "";
  for (const path of urls) {
    if (production)
      assert.ok(path.startsWith(`${prefix}/`), `Built asset must use selected namespace: ${path}`);
    const result = await fetch(new URL(path, origin));
    assert.equal(result.status, 200);
    const type = result.headers.get("content-type") ?? "";
    assert.ok(
      path.includes(".css") ? type.includes("css") : type.includes("javascript"),
      `${path} must be an asset, not history HTML`,
    );
    const body = await result.text();
    assert.ok(!body.includes(marker), "Private server values must never enter browser bundles");
    if (path.includes(".js")) js += body;
  }
  assert.ok(js.includes(prefix), "Actual browser code must receive the selected prefix");
  assert.ok(
    !js.includes("process.env.BUN_PUBLIC_SPA_PREFIX"),
    "Native bundler must inline its explicit public prefix",
  );
  return html;
}
let cleanupPromise: Promise<void> | undefined;
function cleanup() {
  cleanupPromise ??= (async () => {
    for (const child of [...children]) await stop(child);
    if (dockerBuilt && dockerImage) {
      const remove = Bun.spawn(["docker", "image", "rm", "--force", dockerImage], {
        stdout: "ignore",
        stderr: "inherit",
      });
      assert.equal(await remove.exited, 0);
    }
    await fixture.close();
  })();
  return cleanupPromise;
}
const terminate = () => {
  void cleanup().finally(() => process.exit(143));
};
process.once("SIGTERM", terminate);
try {
  await command(["run", "frontend:install"]);
  await command(["run", "frontend:build"]);
  await command([
    join(fixture.app, "node_modules/typescript/bin/tsc"),
    "--noEmit",
    "-p",
    "frontend/tsconfig.json",
  ]);
  if (dockerImage) {
    // Candidate package archives are build inputs, just as npm archives are at publication.
    const manifest = JSON.parse(await readFile(join(fixture.app, "package.json"), "utf8"));
    let candidateArchives = false;
    for (const part of ["core", "bootstrap", "cli"]) {
      const key = `@getstrata/${part}`;
      if (manifest.dependencies[key].startsWith("file:")) {
        candidateArchives = true;
        const archive = manifest.dependencies[key].slice(5);
        await copyFile(archive, join(fixture.app, basename(archive)));
        manifest.dependencies[key] = `file:./${basename(archive)}`;
      }
    }
    await writeFile(join(fixture.app, "package.json"), JSON.stringify(manifest));
    await command(["install"]);
    if (candidateArchives) {
      const dockerfile = join(fixture.app, "Dockerfile");
      await writeFile(
        dockerfile,
        (await readFile(dockerfile, "utf8")).replace(
          "COPY package.json bun.lock ./",
          "COPY package.json bun.lock ./\nCOPY *.tgz ./",
        ),
      );
    }
    const build = Bun.spawn(
      [
        "docker",
        "build",
        "--target",
        "frontend",
        "--build-arg",
        `SPA_PREFIX=${prefix}`,
        "-t",
        dockerImage,
        ".",
      ],
      { cwd: fixture.app, env, stdout: "pipe", stderr: "pipe", timeout: 240000 },
    );
    const [code, out, err] = await Promise.all([
      build.exited,
      new Response(build.stdout).text(),
      new Response(build.stderr).text(),
    ]);
    assert.equal(code, 0, out + err);
    dockerBuilt = true;
    const inspect = Bun.spawn(
      [
        "docker",
        "run",
        "--rm",
        "--entrypoint",
        "bun",
        dockerImage,
        "-e",
        "console.log(await Bun.file('dist/index.html').text())",
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [inspection, errors, inspected] = await Promise.all([
      new Response(inspect.stdout).text(),
      new Response(inspect.stderr).text(),
      inspect.exited,
    ]);
    assert.equal(inspected, 0, errors);
    const assets = [...inspection.matchAll(/(?:src|href)="([^"#]+\.(?:js|css))"/g)];
    assert.ok(assets.length >= 2);
    for (const asset of assets) assert.ok(asset[1]?.startsWith(`${prefix}/`));
  }
  const backendPort = await port(),
    origin = `http://127.0.0.1:${backendPort}`;
  const backend = await start(
    [join(fixture.app, "node_modules/@getstrata/cli/cli.ts"), "start"],
    { PORT: String(backendPort), APP_URL: origin },
    "backend",
  );
  await ready(`${origin}/health`);
  await document(origin, `${prefix}/`, true);
  await document(origin, `${prefix}/orders/42/edit`, true);
  const api = await fetch(`${origin}/api/v1/not-a-route`);
  assert.equal(api.status, 404);
  assert.ok(!(await api.text()).includes('id="root"'));
  if (frontend === "spa-react") {
    const root = await fetch(origin, { redirect: "manual" });
    assert.equal(root.status, 302);
    assert.equal(root.headers.get("location"), `${prefix}/`);
  } else {
    const root = await fetch(origin);
    assert.equal(root.status, 200);
    assert.ok(!(await root.text()).includes('id="root"'));
  }
  const frontPort = await port(),
    frontOrigin = `http://127.0.0.1:${frontPort}`;
  const dev = await start(
    ["run", "frontend:dev"],
    { FRONTEND_PORT: String(frontPort), API_ORIGIN: origin },
    "dev",
  );
  await ready(`${frontOrigin}${prefix}/`);
  await document(frontOrigin, `${prefix}/orders/42/edit`, false);
  assert.equal((await fetch(`${frontOrigin}/api/v1/not-a-route`)).status, 404);
  await stop(dev);
  const preview = await start(
    ["run", "--cwd", "frontend", "preview"],
    { FRONTEND_PORT: String(frontPort), API_ORIGIN: origin },
    "preview",
  );
  await ready(`${frontOrigin}${prefix}/`);
  await document(frontOrigin, `${prefix}/orders/42/edit`, true);
  await stop(preview);
  await stop(backend);
  console.log(
    `PASS ${frontend}/${prefix}: generated build, actual assets/router config, nested history, dev/preview, API isolation and secret redaction`,
  );
} finally {
  process.removeListener("SIGTERM", terminate);
  await cleanup();
}
