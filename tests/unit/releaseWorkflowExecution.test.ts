import { expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveReleasePolicy } from "../../scripts/release-policy.ts";

interface Step {
  name?: string;
  if?: string;
  uses?: string;
  run?: string;
  with?: Record<string, string | boolean>;
}
interface Workflow {
  on: { push: { tags: string[] }; workflow_dispatch: { inputs: Record<string, unknown> } };
  jobs: Record<
    string,
    {
      needs?: string[];
      steps: Step[];
      env?: Record<string, string>;
      outputs?: Record<string, string>;
      permissions?: Record<string, string>;
    }
  >;
}
const root = join(import.meta.dir, "../..");
async function workflow(): Promise<Workflow> {
  return Bun.YAML.parse(
    await readFile(join(root, ".github/workflows/release.yml"), "utf8"),
  ) as Workflow;
}

test("effect jobs retain the original channel baseline and verify stable pointers", async () => {
  const value = await workflow();
  expect(value.jobs["release-policy"]?.outputs?.baseline).toBeDefined();
  expect(value.jobs["release-policy"]?.outputs?.source_commit).toBeDefined();
  expect(value.jobs["release-policy"]?.permissions?.packages).toBe("read");
  for (const job of ["publish-framework", "github-release", "container"]) {
    expect(value.jobs[job]?.env?.RELEASE_CHANNEL_BASELINE).toContain("outputs.baseline");
    expect(
      value.jobs[job]?.steps.find((step) => step.uses === "actions/checkout@v5")?.with?.ref,
    ).toContain("outputs.source_commit");
  }
  const container = value.jobs.container?.steps ?? [];
  const build = container.findIndex((step) => step.name === "Build and push image");
  const before = container.findIndex(
    (step) => step.run === "bun --no-env-file scripts/release-channel-guard.ts before-container",
  );
  const after = container.findIndex(
    (step) => step.run === "bun --no-env-file scripts/release-channel-guard.ts after-container",
  );
  expect(before).toBeGreaterThanOrEqual(0);
  expect(before).toBeLessThan(build);
  expect(after).toBeGreaterThan(build);
  expect(
    value.jobs["github-release"]?.steps.some(
      (step) => step.run === "bun --no-env-file scripts/release-channel-guard.ts after-github",
    ),
  ).toBe(true);
});

test("prerelease publication requires an explicit manual channel and all effects depend on policy", async () => {
  const value = await workflow();
  expect(value.on.push.tags).toContain("!v*-*");
  expect(value.on.workflow_dispatch.inputs.channel).toBeDefined();
  for (const name of ["publish-framework", "github-release", "container"]) {
    expect(value.jobs[name]?.needs).toContain("release-policy");
  }
});

for (const channel of ["stable", "next"]) {
  test(`actual npm shell selects only the ${channel} publication adapter`, async () => {
    const value = await workflow();
    const script = value.jobs["publish-framework"]?.steps.find(
      (step) => step.name === "Publish to npm",
    )?.run;
    expect(script).toBeDefined();
    const fixture = await mkdtemp(join(tmpdir(), "strata-release-npm-selection-"));
    try {
      const { mkdir } = await import("node:fs/promises");
      const trace = join(fixture, "trace.txt");
      for (const [name, directory] of [
        ["@getstrata/core", "strata-core"],
        ["@getstrata/bootstrap", "strata-bootstrap"],
        ["@getstrata/cli", "strata-cli"],
        ["@getstrata/starter", "strata-starter"],
        ["create-strata", "create-strata"],
      ]) {
        await mkdir(join(fixture, "packages", directory ?? ""), { recursive: true });
        await writeFile(
          join(fixture, "packages", directory ?? "", "package.json"),
          JSON.stringify({ name, version: "2.2.59" }),
        );
      }
      const bin = join(fixture, "bin");
      await mkdir(bin);
      await writeFile(
        join(bin, "bun"),
        '#!/bin/bash\nif [ "$1" = scripts/package-publication-status.ts ]; then echo unpublished; exit 0; fi\nprintf "candidate %s\\n" "$*" >> "$RELEASE_TRACE"\n',
      );
      await writeFile(
        join(bin, "npm"),
        '#!/bin/bash\nprintf "npm %s\\n" "$*" >> "$RELEASE_TRACE"\n',
      );
      for (const executable of ["bun", "npm"]) await chmod(join(bin, executable), 0o700);
      const env = {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
        RELEASE_TRACE: trace,
        RELEASE_CHANNEL: channel,
      };
      for (const executable of ["bun", "npm"]) {
        expect(
          Bun.spawnSync(["/bin/bash", "-c", `command -v ${executable}`], { env })
            .stdout.toString()
            .trim(),
        ).toBe(join(bin, executable));
      }
      const result = Bun.spawnSync(
        ["/bin/bash", "-e", "-o", "pipefail", "-c", script ?? "exit 99"],
        { cwd: fixture, env },
      );
      expect(result.exitCode, result.stderr.toString()).toBe(0);
      const calls = (await readFile(trace, "utf8")).trim().split("\n");
      expect(calls).toEqual(
        channel === "next"
          ? ["candidate --no-env-file scripts/candidate-release.ts publish"]
          : [
              "@getstrata/core",
              "@getstrata/bootstrap",
              "@getstrata/cli",
              "@getstrata/starter",
              "create-strata",
            ].map((name) => `npm publish --workspace ${name} --access public --provenance`),
      );
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  test(`actual container shell keeps ${channel} tags isolated`, async () => {
    const value = await workflow();
    const script = value.jobs.container?.steps.find(
      (step) => step.name === "Build and push image",
    )?.run;
    expect(script).toBeDefined();
    const fixture = await mkdtemp(join(tmpdir(), "strata-release-docker-recorder-"));
    try {
      const executable = join(fixture, "docker");
      const trace = join(fixture, "trace.txt");
      await writeFile(executable, '#!/bin/bash\nprintf "%s\\n" "$*" >> "$RELEASE_TRACE"\n');
      await chmod(executable, 0o700);
      const env = {
        ...process.env,
        PATH: `${fixture}:/usr/bin:/bin`,
        RELEASE_TRACE: trace,
        RELEASE_CHANNEL: channel,
        RELEASE_TAG: channel === "next" ? "v3.0.0-alpha.0" : "v2.2.59",
        IMAGE: "ghcr.io/owned-fixture/strata",
        RELEASE_CONTAINER_ALIAS:
          resolveReleasePolicy(channel === "next" ? "3.0.0-alpha.0" : "2.2.59", channel)
            .containerAliases[0] ?? "",
      };
      const guard = Bun.spawnSync(["/bin/bash", "-c", "command -v docker"], { env });
      expect(guard.stdout.toString().trim()).toBe(executable);
      const result = Bun.spawnSync(
        ["/bin/bash", "-e", "-o", "pipefail", "-c", script ?? "exit 99"],
        { cwd: fixture, env },
      );
      expect(result.exitCode, result.stderr.toString()).toBe(0);
      const calls = (await readFile(trace, "utf8")).trim().split("\n");
      expect(calls).toEqual(
        channel === "next"
          ? [
              "build --pull --tag ghcr.io/owned-fixture/strata:v3.0.0-alpha.0 .",
              "push ghcr.io/owned-fixture/strata:v3.0.0-alpha.0",
            ]
          : [
              "build --pull --tag ghcr.io/owned-fixture/strata:v2.2.59 --tag ghcr.io/owned-fixture/strata:latest .",
              "push ghcr.io/owned-fixture/strata:v2.2.59",
              "push ghcr.io/owned-fixture/strata:latest",
            ],
      );
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  test(`actual GitHub action selection gives ${channel} its intended release inputs`, async () => {
    const steps =
      (await workflow()).jobs["github-release"]?.steps.filter((step) =>
        step.uses?.startsWith("softprops/action-gh-release@"),
      ) ?? [];
    // Interpret only this explicit reviewed condition grammar. Any future expression
    // change fails this execution harness instead of silently broadening selection.
    const selected = steps.filter((step) => {
      if (!step.if) return true;
      const match =
        /^\$\{\{ needs\['release-policy'\]\.outputs\.channel == '(stable|next)' \}\}$/.exec(
          step.if,
        );
      if (!match) throw new Error(`Unqualified action condition: ${step.if}`);
      return match[1] === channel;
    });
    expect(selected).toHaveLength(1);
    const policy = resolveReleasePolicy(channel === "next" ? "3.0.0-alpha.0" : "2.2.59", channel);
    const inputs = Object.fromEntries(
      Object.entries(selected[0]?.with ?? {}).map(([name, value]) => {
        if (typeof value !== "string" || !value.includes("fromJSON")) return [name, value];
        const match =
          /^\$\{\{ fromJSON\(needs\['release-policy'\]\.outputs\.policy\)\.github\.(prerelease|makeLatest) \}\}$/.exec(
            value,
          );
        if (!match) throw new Error(`Unqualified policy input ${value}`);
        return [name, policy.github[match[1] as "prerelease" | "makeLatest"]];
      }),
    );
    expect(inputs.generate_release_notes).toBe(true);
    if (channel === "next") {
      expect(inputs.prerelease).toBe(true);
      expect(String(inputs.make_latest)).toBe("false");
    } else {
      expect(inputs.prerelease).toBeUndefined();
      expect(inputs.make_latest).toBeUndefined();
    }
  });
}

test("actual fresh/recovery step conditions cannot repack a retained candidate", async () => {
  const steps = (await workflow()).jobs["publish-framework"]?.steps ?? [];
  const names = [
    "Verify retained candidate source run",
    "Download original candidate artifacts",
    "Pack next candidate once",
    "Retain immutable next candidate artifacts",
  ];
  for (const [channel, resume, expected] of [
    ["stable", "", []],
    ["next", "", ["Pack next candidate once", "Retain immutable next candidate artifacts"]],
    [
      "next",
      "123",
      ["Verify retained candidate source run", "Download original candidate artifacts"],
    ],
  ] as const) {
    const selected = steps
      .filter((step) => names.includes(step.name ?? ""))
      .filter((step) => {
        const match =
          /^\$\{\{ needs\['release-policy'\]\.outputs\.channel == 'next' && inputs\.resume_run_id (==|!=) '' \}\}$/.exec(
            step.if ?? "",
          );
        if (!match) throw new Error(`Unqualified candidate condition ${step.if}`);
        return channel === "next" && (match[1] === "==" ? resume === "" : resume !== "");
      })
      .map((step) => step.name);
    expect(selected).toEqual([...expected]);
  }
});
