import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type CandidateLedger, packCandidateArtifacts } from "../../scripts/candidate-artifacts.ts";
import { publishCandidate } from "../../scripts/candidate-publication.ts";
import { createReleaseWorkspace, runReleaseFixture } from "../helpers/releaseWorkspace.ts";

const source = { commit: "1".repeat(40), repository: "EyK-26/strata", runId: "123" };
let root: string;
let ledger: CandidateLedger;
let attempt = 0;

beforeAll(async () => {
  root = await createReleaseWorkspace();
  expect((await runReleaseFixture(root, ["install", "--ignore-scripts"])).code).toBe(0);
  expect(
    (await runReleaseFixture(root, ["scripts/bump.ts", "2.0.0-alpha.0", "--channel", "next"])).code,
  ).toBe(0);
  ledger = await packCandidateArtifacts(root, join(root, "candidate"), source);
  await mkdir(join(root, "bin"));
});
afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

async function registryFixture(
  options: {
    failUpload?: number;
    unavailable?: string;
    foreignBefore?: string;
    changeLatest?: boolean;
    acknowledgeFailure?: boolean;
  } = {},
) {
  const metadata = new Map(
    ledger.packages.map((artifact) => [
      artifact.name,
      {
        name: artifact.name,
        versions: { "1.0.0": { name: artifact.name, version: "1.0.0" } } as Record<string, unknown>,
        "dist-tags": { latest: "1.0.0" } as Record<string, string>,
      },
    ]),
  );
  const calls: string[][] = [];
  const reads = new Map<string, number>();
  const state = { failUpload: options.failUpload };
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname === "/publish") {
        const args = (await request.json()) as string[];
        calls.push(args);
        const failed = calls.length === state.failUpload;
        if (failed && !options.acknowledgeFailure)
          return new Response("owned upload rejection", { status: 503 });
        const artifact = ledger.packages.find(
          (entry) => args[1] === join(root, "candidate", entry.file),
        );
        if (!artifact) return new Response("unexpected artifact", { status: 400 });
        const entry = metadata.get(artifact.name);
        if (!entry) return new Response("unknown package", { status: 400 });
        entry.versions[artifact.version] = {
          name: artifact.name,
          version: artifact.version,
          dist: { integrity: artifact.integrity },
        };
        entry["dist-tags"].next = artifact.version;
        if (options.changeLatest) entry["dist-tags"].latest = "foreign-stable";
        return new Response("recorded owned publication", { status: failed ? 503 : 200 });
      }
      const name = new URL(request.url).pathname.slice(1);
      if (name === options.unavailable)
        return new Response("owned unavailable registry", { status: 503 });
      const entry = metadata.get(name);
      if (!entry) return new Response("unknown package", { status: 404 });
      const count = (reads.get(name) ?? 0) + 1;
      reads.set(name, count);
      if (name === options.foreignBefore && count === 2)
        entry["dist-tags"].next = "foreign-candidate";
      return Response.json(entry);
    },
  });
  const endpoint = `http://127.0.0.1:${server.port}`;
  const publishExecutable = join(root, "bin", `record-candidate-publication-${attempt + 1}`);
  await writeFile(
    publishExecutable,
    `#!${process.execPath}\nif(process.argv[2] === "--fixture-self-check") { console.log("owned publication recorder"); process.exit(0); }\nconst response = await fetch(${JSON.stringify(`${endpoint}/publish`)}, {method:"POST",body:JSON.stringify(process.argv.slice(2))}); process.exit(response.ok ? 0 : 7);\n`,
  );
  await chmod(publishExecutable, 0o700);
  const guard = Bun.spawnSync([publishExecutable, "--fixture-self-check"]);
  expect(guard.exitCode).toBe(0);
  expect(guard.stdout.toString().trim()).toBe("owned publication recorder");
  const request = (url: string) =>
    fetch(`${endpoint}/${url.slice("https://registry.npmjs.org/".length)}`);
  const publish = async () => {
    const id = `123-${++attempt}`;
    await publishCandidate(root, join(root, "candidate"), source, id, request, publishExecutable);
    return id;
  };
  return {
    metadata,
    calls,
    state,
    publish,
    receipt: () =>
      readFile(join(root, "candidate", `publication-123-${attempt}.json`), "utf8").then(JSON.parse),
    close: () => server.stop(true),
  };
}

test("actual native publish argv pins retained files to next and verifies all five stable pointers", async () => {
  const fixture = await registryFixture();
  try {
    await fixture.publish();
    expect(fixture.calls).toHaveLength(5);
    for (const [index, args] of fixture.calls.entries()) {
      expect(args).toEqual([
        "publish",
        join(root, "candidate", ledger.packages[index]?.file ?? "missing"),
        "--tag",
        "next",
        "--access",
        "public",
        "--provenance",
        "--ignore-scripts",
      ]);
    }
    for (const entry of fixture.metadata.values()) {
      expect(entry["dist-tags"].latest).toBe("1.0.0");
      expect(entry["dist-tags"].next).toBe(ledger.version);
    }
    expect((await fixture.receipt()).outcome).toBe("success");
    expect((await fixture.receipt()).verified).toHaveLength(5);
  } finally {
    await fixture.close();
  }
});

for (let position = 1; position <= 5; position++) {
  test(`package ${position} upload failure preserves partial counts and a byte-verified resume`, async () => {
    const fixture = await registryFixture({ failUpload: position });
    try {
      await expect(fixture.publish()).rejects.toThrow("upload failed");
      const failed = await fixture.receipt();
      expect(failed.outcome).toBe("incomplete");
      expect(failed.completed).toHaveLength(position - 1);
      expect(failed.attempted).toHaveLength(position);
      fixture.state.failUpload = undefined;
      await fixture.publish();
      expect(fixture.calls).toHaveLength(6);
      expect((await fixture.receipt()).outcome).toBe("success");
      expect((await fixture.receipt()).skipped).toHaveLength(position - 1);
    } finally {
      await fixture.close();
    }
  });
}

test("unknown registry state preflights every package before any upload", async () => {
  const fixture = await registryFixture({ unavailable: "create-strata" });
  try {
    await expect(fixture.publish()).rejects.toThrow("Cannot verify published versions");
    expect(fixture.calls).toHaveLength(0);
    expect((await fixture.receipt()).outcome).toBe("incomplete");
  } finally {
    await fixture.close();
  }
});

test("a lost acknowledgement resumes by verified bytes without republishing the accepted upload", async () => {
  const fixture = await registryFixture({ failUpload: 1, acknowledgeFailure: true });
  try {
    await expect(fixture.publish()).rejects.toThrow("upload failed");
    const failedPath = join(root, "candidate", `publication-123-${attempt}.json`);
    const failed = await readFile(failedPath, "utf8");
    expect(JSON.parse(failed).completed).toHaveLength(0);
    fixture.state.failUpload = undefined;
    await fixture.publish();
    expect(fixture.calls).toHaveLength(5);
    expect((await fixture.receipt()).skipped).toHaveLength(1);
    expect((await fixture.receipt()).outcome).toBe("success");
    expect(await readFile(failedPath, "utf8")).toBe(failed);
  } finally {
    await fixture.close();
  }
});

test("an observed foreign channel move stops before overwriting it", async () => {
  const fixture = await registryFixture({ foreignBefore: "@getstrata/core" });
  try {
    await expect(fixture.publish()).rejects.toThrow("pointer changed");
    expect(fixture.calls).toHaveLength(0);
    expect((await fixture.receipt()).outcome).toBe("incomplete");
  } finally {
    await fixture.close();
  }
});

test("a changed stable pointer prevents acceptance and is never automatically restored", async () => {
  const fixture = await registryFixture({ changeLatest: true });
  try {
    await expect(fixture.publish()).rejects.toThrow("pointer");
    expect((await fixture.receipt()).outcome).toBe("incomplete");
    expect(fixture.metadata.get("@getstrata/core")?.["dist-tags"].latest).toBe("foreign-stable");
  } finally {
    await fixture.close();
  }
});
