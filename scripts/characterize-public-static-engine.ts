import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { join, resolve } from "node:path";
import { removeOwnedDockerContainers } from "../tests/helpers/ownedDockerContainers.ts";

// Opt-in provider feasibility only: no framework adapter, publisher or public API.
const output = process.argv[2];
const imageArgument = process.argv[3];
assert.ok(output, "Pass a new evidence directory.");
assert.ok(imageArgument, "Pass an already pulled exact image digest.");
const image = imageArgument;
assert.match(image, /^nginx@sha256:[a-f0-9]{64}$/);
const requestedEvidence = resolve(output);
await mkdir(requestedEvidence);
const evidence = await realpath(requestedEvidence);
const scratch = await mkdtemp(join(evidence, "owned-inputs-"));
const publicRoot = join(scratch, "public");
const names: string[] = [];
const commands: Array<{ args: string[]; exitCode: number }> = [];
const results: Array<Record<string, unknown>> = [];
const scripts = new Map<string, string>();
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const large = Buffer.alloc(64 * 1024 * 1024, 90);
const expectedHash = digest(large);

async function bounded<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Static engine probe deadline")), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function run(args: string[], includeStderr = false): Promise<string> {
  const child = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  try {
    const [stdout, stderr, exitCode] = await bounded(
      Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]),
      20_000,
    );
    commands.push({ args, exitCode });
    assert.equal(exitCode, 0, `${args.join(" ")}: ${stderr}`);
    return (includeStderr ? stdout + stderr : stdout).trim();
  } catch (error) {
    child.kill();
    throw error;
  }
}

async function start() {
  const name = `strata-m1-static-${randomUUID()}`;
  names.push(name); // Ownership is recorded before Docker creates anything.
  const id = await run([
    "docker",
    "create",
    "--name",
    name,
    "--label",
    `strata.m1.owner=${name}`,
    "--read-only",
    "--user",
    "nginx",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--publish",
    "127.0.0.1::8080",
    "--mount",
    `type=bind,src=${publicRoot},dst=/srv/public,readonly`,
    "--mount",
    `type=bind,src=${join(scratch, "nginx.conf")},dst=/fixture.conf,readonly`,
    "--tmpfs",
    "/tmp:mode=1777",
    "--tmpfs",
    "/var/cache/nginx:mode=1777",
    "--entrypoint",
    "nginx",
    image,
    "-c",
    "/fixture.conf",
    "-g",
    "daemon off;",
  ]);
  assert.match(id, /^[a-f0-9]{64}$/);
  const [before] = JSON.parse(await run(["docker", "inspect", id]));
  assert.equal(before.Config.Labels["strata.m1.owner"], name);
  assert.deepEqual(
    before.Mounts.filter((mount: { Type: string }) => mount.Type === "bind")
      .map((mount: { Destination: string; RW: boolean }) => [mount.Destination, mount.RW])
      .sort(),
    [
      ["/fixture.conf", false],
      ["/srv/public", false],
    ],
  );
  await writeFile(
    join(evidence, `${name}-created.json`),
    `${JSON.stringify({ id, name, image })}\n`,
  );
  await run(["docker", "start", id]);
  const [started] = JSON.parse(await run(["docker", "inspect", id]));
  const [port] = started.NetworkSettings.Ports["8080/tcp"];
  assert.equal(port.HostIp, "127.0.0.1");
  const origin = `http://127.0.0.1:${port.HostPort}`;
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(500) });
      assert.equal(response.status, 200);
      assert.equal(await response.text(), "static-fixture-ready");
      break;
    } catch (error) {
      if (attempt === 39) throw error;
      await Bun.sleep(50);
    }
  }
  return { id, origin, port: Number(port.HostPort), name };
}

async function quit(id: string) {
  await run(["docker", "kill", "--signal", "QUIT", id]);
}

async function stopped(id: string) {
  assert.equal(await run(["docker", "wait", id]), "0", "Native graceful shutdown must succeed.");
}

function request(url: string, init: RequestInit = {}) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(5000) });
}

async function protocolCases() {
  const server = await start();
  const path = "/releases/build-A/app.js";
  const response = await request(`${server.origin}${path}`);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), scripts.get("A"));
  assert.match(response.headers.get("content-type") ?? "", /javascript/);
  assert.match(response.headers.get("cache-control") ?? "", /immutable/);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(response.headers.get("access-control-allow-credentials"), null);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  const etag = response.headers.get("etag");
  assert.ok(etag);
  const cached = await request(`${server.origin}${path}`, { headers: { "If-None-Match": etag } });
  assert.equal(cached.status, 304);
  assert.equal(await cached.text(), "");
  const head = await request(`${server.origin}/releases/build-A/large.bin`, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(Number(head.headers.get("content-length")), large.length);
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  const ranged = await request(`${server.origin}/releases/build-A/large.bin`, {
    headers: { Range: "bytes=1-32" },
  });
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers.get("content-range"), `bytes 1-32/${large.length}`);
  assert.deepEqual(Buffer.from(await ranged.arrayBuffer()), large.subarray(1, 33));
  const invalid = await request(`${server.origin}/releases/build-A/large.bin`, {
    headers: { Range: `bytes=${large.length}-` },
  });
  assert.equal(invalid.status, 416);
  await invalid.arrayBuffer();
  for (const missing of ["/private.txt", "/app.js", "/releases/build-A/missing.js"]) {
    const missingResponse = await request(`${server.origin}${missing}`);
    assert.equal(missingResponse.status, 404);
    assert.doesNotMatch(missingResponse.headers.get("cache-control") ?? "", /immutable/);
    await missingResponse.arrayBuffer();
  }
  const linked = await request(`${server.origin}/releases/build-A/linked.js`);
  assert.ok(
    linked.status === 403 || linked.status === 404,
    "Even an in-tree symlink must be denied by this engine policy.",
  );
  assert.doesNotMatch(await linked.text(), /globalThis\.staticBuild/);
  const accent = await request(
    `${server.origin}/releases/build-A/${encodeURIComponent("příloha +.txt")}`,
  );
  assert.equal(await accent.text(), "Příliš žluťoučký kůň\n");
  for (const build of ["B", "A"]) {
    const oldOrNew = await request(`${server.origin}/releases/build-${build}/app.js`);
    assert.equal(oldOrNew.status, 200);
    assert.equal(await oldOrNew.text(), scripts.get(build));
  }
  results.push({ case: "static-protocol-and-retained-builds", passed: true });
  await quit(server.id);
  await stopped(server.id);
}

async function fileDrain(pipeline: boolean, repetition: number) {
  const server = await start();
  const socket = connect(server.port, "127.0.0.1");
  let ready!: () => void;
  let closed!: () => void;
  const headersReady = new Promise<void>((accept) => {
    ready = accept;
  });
  const connectionClosed = new Promise<void>((accept) => {
    closed = accept;
  });
  let header = Buffer.alloc(0);
  let hasHeaders = false;
  let received = 0;
  let extra = "";
  let socketError: string | null = null;
  const hash = createHash("sha256");
  socket.on("error", (error) => {
    socketError = error.message;
  });
  socket.on("close", closed);
  socket.on("connect", () =>
    socket.write(
      "GET /releases/build-A/large.bin HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: keep-alive\r\n\r\n",
    ),
  );
  socket.on("data", (data: Buffer) => {
    if (!hasHeaders) {
      header = Buffer.concat([header, data]);
      const boundary = header.indexOf("\r\n\r\n");
      if (boundary < 0) return;
      hasHeaders = true;
      data = header.subarray(boundary + 4);
      header = header.subarray(0, boundary + 4);
      socket.pause();
      ready();
    }
    const count = Math.min(data.length, large.length - received);
    hash.update(data.subarray(0, count));
    received += count;
    if (data.length > count) extra += data.subarray(count).toString();
  });
  try {
    await bounded(headersReady, 5000);
    assert.match(header.toString(), /^HTTP\/1\.1 200 /);
    const declaredLength = Number(header.toString().match(/^content-length:\s*(\d+)\s*$/im)?.[1]);
    assert.equal(declaredLength, large.length);
    assert.ok(received < large.length, "Shutdown must start while the response is incomplete.");
    const receivedBeforeQuit = received;
    await quit(server.id);
    assert.equal(
      await run(["docker", "inspect", server.id, "--format", "{{.State.Running}}"]),
      "true",
    );
    if (pipeline)
      socket.write("GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: keep-alive\r\n\r\n");
    await Bun.sleep(50);
    socket.resume();
    await bounded(connectionClosed, 5000);
    await stopped(server.id);
    const sha256 = hash.digest("hex");
    const result = {
      case: "native-64MiB-graceful-drain",
      pipeline,
      repetition,
      declaredLength,
      receivedBytes: received,
      receivedBeforeQuit,
      expectedBytes: large.length,
      sha256,
      expectedSha256: expectedHash,
      socketError,
      laterResponseObserved: extra.includes("static-fixture-ready"),
      fullBodyMatches: received === large.length && sha256 === expectedHash,
    };
    results.push(result);
    assert.ok(result.fullBodyMatches, "A full declared body and exact digest are required.");
    assert.equal(socketError, null);
  } finally {
    socket.destroy();
  }
}

let failure: unknown;
let cleaned = false;
let engine: unknown;
try {
  engine = JSON.parse(await run(["docker", "image", "inspect", image, "--format", "{{json .}}"]));
  await mkdir(join(publicRoot, "releases", "build-A"), { recursive: true });
  await mkdir(join(publicRoot, "releases", "build-B"));
  await chmod(scratch, 0o755);
  await writeFile(join(publicRoot, "releases", "build-A", "large.bin"), large);
  for (const build of ["A", "B"]) {
    const input = join(scratch, `input-${build}.ts`);
    await writeFile(input, `globalThis.staticBuild = '${build}';\n`);
    const built = await Bun.build({
      entrypoints: [input],
      target: "browser",
      naming: "app.js",
      outdir: join(publicRoot, "releases", `build-${build}`),
    });
    assert.ok(built.success, "Use actual unchanged native build output.");
    assert.equal(built.outputs.length, 1);
    const entry = built.outputs[0];
    assert.ok(entry);
    scripts.set(build, await entry.text());
  }
  await writeFile(
    join(publicRoot, "releases", "build-A", "příloha +.txt"),
    "Příliš žluťoučký kůň\n",
  );
  await symlink("app.js", join(publicRoot, "releases", "build-A", "linked.js"));
  await writeFile(
    join(scratch, "nginx.conf"),
    `
worker_processes 1;
pid /tmp/nginx.pid;
error_log /dev/stderr notice;
events { worker_connections 128; }
http {
  include /etc/nginx/mime.types;
  default_type application/octet-stream;
  access_log /dev/stdout;
  sendfile on;
  server {
    listen 8080;
    server_name _;
    root /srv/public;
    disable_symlinks on from=/srv/public;
    location = /health { return 200 'static-fixture-ready'; }
    location /releases/ {
      try_files $uri =404;
      add_header Cache-Control 'public, max-age=31536000, immutable';
      add_header Access-Control-Allow-Origin '*' always;
      add_header X-Content-Type-Options nosniff always;
    }
    location / { return 404; }
  }
}
`,
  );
  const first = await start();
  await writeFile(
    join(evidence, "engine-version.txt"),
    await run(["docker", "exec", first.id, "nginx", "-V"], true),
  );
  await quit(first.id);
  await stopped(first.id);
  await protocolCases();
  for (const pipeline of [false, true]) {
    for (let repetition = 1; repetition <= 2; repetition++) await fileDrain(pipeline, repetition);
  }
} catch (error) {
  failure = error;
} finally {
  const cleanupErrors: unknown[] = [];
  const verifiedNames: string[] = [];
  for (const name of names) {
    try {
      const id = await run([
        "docker",
        "container",
        "ls",
        "-aq",
        "--no-trunc",
        "--filter",
        `name=^/${name}$`,
      ]);
      if (!id) continue;
      const label = await run([
        "docker",
        "inspect",
        id,
        "--format",
        '{{index .Config.Labels "strata.m1.owner"}}',
      ]);
      assert.equal(
        label,
        name,
        "Refuse to touch a container without this invocation's owner token.",
      );
      verifiedNames.push(name);
      const log = await run(["docker", "logs", name], true);
      await writeFile(join(evidence, `${name}.log`), log);
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  try {
    await removeOwnedDockerContainers(run, verifiedNames);
    await rm(scratch, { recursive: true });
    cleaned = true;
  } catch (error) {
    cleanupErrors.push(error);
  }
  if (cleanupErrors.length) {
    failure = new AggregateError(
      [failure, ...cleanupErrors].filter(Boolean),
      "Feasibility or owned cleanup failed.",
    );
  }
  await writeFile(
    join(evidence, "results.json"),
    `${JSON.stringify(
      {
        image,
        engine,
        runtime: { bun: Bun.version, revision: Bun.revision },
        nativeEntryHashes: Object.fromEntries(
          [...scripts].map(([build, text]) => [build, digest(new TextEncoder().encode(text))]),
        ),
        results,
        ownedContainers: names,
        ownedContainersAndScratchRemoved: cleaned,
        commands,
        error: failure instanceof Error ? failure.message : failure ? String(failure) : null,
        scope: "Local engine feasibility only; no production provider or framework API acceptance.",
      },
      null,
      2,
    )}\n`,
  );
}
if (failure) throw failure;
assert.equal(results.length, 5);
assert.ok(cleaned);
console.log(
  "PASS: static protocol controls and four exact 64MiB graceful-drain cases; owned cleanup complete.",
);
