import assert from "node:assert/strict";

const MAILPIT_IMAGE =
  "axllent/mailpit@sha256:b68349e3a014b90c5610bfb26b2ae36f3892d7b8cf25ee140c6c71c98d2fcf48";
type Ports = { smtpPort: number; httpPort: number };
type DockerCommand = (args: string[]) => string | Promise<string>;

/** These are candidates, not an atomic reservation in the Docker daemon's allocator. */
async function candidateMailpitPorts(): Promise<Ports> {
  const smtp = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  try {
    const http = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
    try {
      assert.ok(smtp.port && http.port);
      return { smtpPort: smtp.port, httpPort: http.port };
    } finally {
      await http.stop(true);
    }
  } finally {
    await smtp.stop(true);
  }
}

/** Own the container before starting it; retry only port admission, never a journey. */
async function startOwnedMailpit(
  docker: DockerCommand,
  name: string,
  allocatePorts: () => Promise<Ports> = candidateMailpitPorts,
) {
  assert.match(name, /^[A-Za-z0-9][A-Za-z0-9_.-]*$/);
  const collisions: unknown[] = [];
  for (let attempt = 1; attempt <= 5; attempt++) {
    const ports = await allocatePorts();
    const id = await docker([
      "create",
      "--name",
      name,
      "--publish",
      `127.0.0.1:${ports.smtpPort}:1025`,
      "--publish",
      `127.0.0.1:${ports.httpPort}:8025`,
      MAILPIT_IMAGE,
    ]);
    let closed = false;
    async function close() {
      if (closed) return;
      await docker(["rm", "--force", "--volumes", id]);
      closed = true;
    }
    let starting = true;
    try {
      await docker(["start", id]);
      starting = false;
      const bindings = JSON.parse(
        await docker(["inspect", "--format", "{{json .NetworkSettings.Ports}}", id]),
      ) as Record<string, Array<{ HostPort: string }>>;
      assert.equal(Number(bindings["1025/tcp"]?.[0]?.HostPort), ports.smtpPort);
      assert.equal(Number(bindings["8025/tcp"]?.[0]?.HostPort), ports.httpPort);
      return { id, name, attempts: attempt, ...ports, close };
    } catch (error) {
      try {
        await close();
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], "Owned Mailpit startup cleanup failed.");
      }
      if (
        !starting ||
        !(error instanceof Error) ||
        !/port is already allocated|address already in use|failed to bind host port/i.test(
          error.message,
        )
      )
        throw error;
      collisions.push(error);
      if (attempt < 5)
        console.warn(`[fixture] Mailpit port collision; retrying startup (${attempt}/5).`);
    }
  }
  throw new AggregateError(collisions, "Owned Mailpit port allocation failed after 5 attempts.");
}

export { candidateMailpitPorts, MAILPIT_IMAGE, startOwnedMailpit };
