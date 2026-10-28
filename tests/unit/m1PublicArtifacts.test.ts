import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectPublicArtifactManifest,
  createPublicArtifactResolver,
  prepareDocumentArtifacts,
  verifyPublicArtifactFiles,
} from "../../src/bootstrap/m1/publicArtifacts";
import { assertApprovedDestination } from "../../src/bootstrap/m1/validation";

const integrity = `sha256-${Buffer.alloc(32, 1).toString("base64")}`;
const entry = () => ({
  relativePath: "entry-123.js",
  mediaType: "text/javascript",
  bytes: 3,
  integrity,
});
const manifest = () => ({
  format: 1,
  buildId: "build-A",
  artifacts: {
    main: entry(),
    style: { ...entry(), relativePath: "style.css", mediaType: "text/css" },
  },
});
const policy = { origin: "https://assets.example.test", releasePrefix: "/releases/build-A/" };

describe("M1 public artifact prototype", () => {
  test("invalid names/media/origins, malformed lists and destination escapes reject", () => {
    expect(() =>
      createPublicArtifactResolver({ ...manifest(), artifacts: { "bad name": entry() } }, policy),
    ).toThrow();
    for (const mediaType of ["text/html", "invalid", "Text/Javascript"])
      expect(() =>
        createPublicArtifactResolver(
          { ...manifest(), artifacts: { main: { ...entry(), mediaType } } },
          policy,
        ),
      ).toThrow();
    expect(() =>
      createPublicArtifactResolver(manifest(), { ...policy, origin: "invalid" }),
    ).toThrow();
    const resolver = createPublicArtifactResolver(manifest(), policy);
    for (const windowModules of [null, new Array(1), [1]])
      expect(() =>
        prepareDocumentArtifacts(resolver, {
          buildId: "build-A",
          entryScripts: [],
          windowModules: windowModules as never,
          stylesheets: [],
        }),
      ).toThrow();
    assertApprovedDestination(
      new URL("https://assets.example.test/releases/build-A/a.js"),
      new URL(policy.origin),
      policy.releasePrefix,
    );
    expect(() =>
      assertApprovedDestination(
        new URL("https://other.test/releases/build-A/a.js"),
        new URL(policy.origin),
        policy.releasePrefix,
      ),
    ).toThrow();
    expect(() =>
      assertApprovedDestination(
        new URL("https://assets.example.test/releases/other/a.js"),
        new URL(policy.origin),
        policy.releasePrefix,
      ),
    ).toThrow();
  });
  test("copies a per-build snapshot with own-key lookup and exact approved URLs", () => {
    const input = manifest();
    const resolver = createPublicArtifactResolver(input, policy);
    input.artifacts.main.relativePath = "changed.js";
    expect(resolver.resolve("main")).toEqual({
      url: "https://assets.example.test/releases/build-A/entry-123.js",
      mediaType: "text/javascript",
      bytes: 3,
      integrity,
    });
    expect(Object.isFrozen(resolver.resolve("main"))).toBe(true);
    expect(() => resolver.resolve("toString")).toThrow();
    expect(() => resolver.resolve("__proto__")).toThrow();
  });
  for (const path of [
    "/private",
    "../secret",
    "a/../b",
    "a//b",
    "a\\b",
    "a%2fb",
    "a?b",
    "a#b",
    "./a",
    "a/",
    "a<.js",
  ]) {
    test(`rejects noncanonical output path ${JSON.stringify(path)}`, () => {
      const input = manifest();
      input.artifacts.main.relativePath = path;
      expect(() => createPublicArtifactResolver(input, policy)).toThrow();
    });
  }
  for (const value of [
    null,
    [],
    1,
    { ...manifest(), unknown: true },
    { ...manifest(), format: 2 },
    { ...manifest(), buildId: ".." },
  ]) {
    test(`rejects malformed manifest ${JSON.stringify(value)}`, () => {
      expect(() => createPublicArtifactResolver(value, policy)).toThrow();
    });
  }
  test("rejects getters without executing them and rejects prototype records", () => {
    let reads = 0;
    const input = manifest();
    Object.defineProperty(input.artifacts, "main", {
      enumerable: true,
      get() {
        reads++;
        return entry();
      },
    });
    expect(() => createPublicArtifactResolver(input, policy)).toThrow();
    expect(reads).toBe(0);
    expect(() => createPublicArtifactResolver(Object.create(manifest()), policy)).toThrow();
  });
  for (const bytes of [-1, 1.2, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity]) {
    test(`rejects invalid byte count ${bytes}`, () => {
      const input = manifest();
      input.artifacts.main.bytes = bytes;
      expect(() => createPublicArtifactResolver(input, policy)).toThrow();
    });
  }
  for (const digest of [
    "sha256-abc",
    "sha384-abc",
    `sha256-${Buffer.alloc(31).toString("base64")}`,
    `sha256-${Buffer.alloc(32).toString("base64").replace(/=$/, "")}`,
  ]) {
    test(`rejects invalid digest ${digest}`, () => {
      const input = manifest();
      input.artifacts.main.integrity = digest;
      expect(() => createPublicArtifactResolver(input, policy)).toThrow();
    });
  }
  test("rejects duplicate destinations and unapproved production origins", () => {
    const input = manifest();
    input.artifacts.style.relativePath = input.artifacts.main.relativePath;
    expect(() => createPublicArtifactResolver(input, policy)).toThrow();
    for (const origin of [
      "http://assets.example.test",
      "https://user:pass@assets.example.test",
      "https://assets.example.test/",
      "https://assets.example.test?q=1",
      "https://ASSETS.example.test",
    ])
      expect(() => createPublicArtifactResolver(manifest(), { ...policy, origin })).toThrow();
    for (const releasePrefix of [
      "/releases/other/",
      "//build-A/",
      "/a/../build-A/",
      "/releases/build-A",
    ])
      expect(() =>
        createPublicArtifactResolver(manifest(), { ...policy, releasePrefix }),
      ).toThrow();
  });
  test("HTTP loopback requires an explicit fixture policy", () => {
    const local = { ...policy, origin: "http://127.0.0.1:1234" };
    expect(() => createPublicArtifactResolver(manifest(), local)).toThrow();
    expect(
      createPublicArtifactResolver(manifest(), local, { allowHttpLoopback: true }).resolve("main")
        .url,
    ).toStartWith(local.origin);
    expect(() =>
      createPublicArtifactResolver(
        manifest(),
        { ...local, origin: "http://other.test" },
        { allowHttpLoopback: true },
      ),
    ).toThrow();
  });
  test("document data is same-build, copied, module-complete for the selected plan and script safe", () => {
    const resolver = createPublicArtifactResolver(manifest(), policy);
    const plan = {
      buildId: "build-A",
      entryScripts: ["main"],
      windowModules: ["main"],
      stylesheets: ["style"],
    };
    const data = prepareDocumentArtifacts(resolver, plan);
    plan.entryScripts.length = 0;
    expect(data.entryScripts.length).toBe(1);
    expect(Object.isFrozen(data.windowIntegrity)).toBe(true);
    expect(JSON.parse(data.importMapJson)).toEqual({
      integrity: { [resolver.resolve("main").url]: integrity },
    });
    expect(data.importMapJson).not.toContain("<");
    expect(() => prepareDocumentArtifacts(resolver, { ...plan, buildId: "other" })).toThrow();
    expect(() =>
      prepareDocumentArtifacts(resolver, { ...plan, entryScripts: ["main"], windowModules: [] }),
    ).toThrow();
    expect(() =>
      prepareDocumentArtifacts(resolver, { ...plan, windowModules: ["style"] }),
    ).toThrow();
    expect(() => prepareDocumentArtifacts(resolver, { ...plan, stylesheets: ["main"] })).toThrow();
  });
  test("document lists reject accessors and script serialization handles hostile data defensively", () => {
    let reads = 0;
    const list = Object.defineProperty([], "0", {
      enumerable: true,
      get() {
        reads++;
        return "main";
      },
    });
    expect(() =>
      prepareDocumentArtifacts(createPublicArtifactResolver(manifest(), policy), {
        buildId: "build-A",
        entryScripts: [],
        windowModules: list,
        stylesheets: [],
      }),
    ).toThrow();
    expect(reads).toBe(0);
    const hostile = {
      buildId: "A",
      resolve: () => ({
        url: "https://assets.test/</script><script>bad&\u2028\u2029",
        bytes: 0,
        integrity,
        mediaType: "text/javascript",
      }),
    };
    const result = prepareDocumentArtifacts(hostile, {
      buildId: "A",
      entryScripts: ["main"],
      windowModules: ["main"],
      stylesheets: [],
    });
    expect(result.importMapJson).not.toContain("<");
    expect(result.importMapJson).not.toContain("&");
    expect(Object.keys(JSON.parse(result.importMapJson).integrity)).toEqual([
      hostile.resolve().url,
    ]);
  });
  test("collects explicitly selected actual native outputs with exact bytes and digests", async () => {
    const root = await mkdtemp(join(tmpdir(), "m1-native-outputs-"));
    try {
      const source = join(root, "entry.ts");
      await writeFile(source, "export const value=42;");
      const result = await Bun.build({
        entrypoints: [source],
        outdir: join(root, "dist"),
        target: "browser",
        naming: "[name]-[hash].[ext]",
      });
      expect(result.success).toBe(true);
      const output = result.outputs[0];
      if (!output) throw new Error("Missing native output");
      const input = await collectPublicArtifactManifest({
        buildId: "build-A",
        outputDirectory: join(root, "dist"),
        outputs: result.outputs,
        selected: [{ logicalName: "main", outputPath: output.path }],
      });
      expect(input.artifacts.main?.bytes).toBe(output.size);
      expect(input.artifacts.main?.integrity).toBe(
        `sha256-${new Bun.CryptoHasher("sha256").update(await output.arrayBuffer()).digest("base64")}`,
      );
      expect(() => createPublicArtifactResolver(input, policy)).not.toThrow();
      await expect(
        collectPublicArtifactManifest({
          buildId: "build-A",
          outputDirectory: join(root, "dist"),
          outputs: [output, output],
          selected: [],
        }),
      ).rejects.toThrow("duplicate-output");
      await expect(
        collectPublicArtifactManifest({
          buildId: "build-A",
          outputDirectory: join(root, "dist"),
          outputs: result.outputs,
          selected: [
            { logicalName: "main", outputPath: output.path },
            { logicalName: "second", outputPath: output.path },
          ],
        }),
      ).rejects.toThrow("duplicate-selection");
      await verifyPublicArtifactFiles(input, join(root, "dist"));
      const originalBytes = await output.arrayBuffer();
      const altered = new Uint8Array(originalBytes.slice(0));
      altered[0] = (altered[0] ?? 0) ^ 1;
      await writeFile(output.path, altered);
      await expect(verifyPublicArtifactFiles(input, join(root, "dist"))).rejects.toThrow(
        "native-output-changed",
      );
      await writeFile(output.path, new Uint8Array(originalBytes));
      await expect(
        collectPublicArtifactManifest({
          buildId: "build-A",
          outputDirectory: join(root, "dist"),
          outputs: result.outputs,
          selected: [{ logicalName: "missing", outputPath: source }],
        }),
      ).rejects.toThrow();
      await writeFile(output.path, "changed after native build");
      await expect(
        collectPublicArtifactManifest({
          buildId: "build-A",
          outputDirectory: join(root, "dist"),
          outputs: result.outputs,
          selected: [{ logicalName: "main", outputPath: output.path }],
        }),
      ).rejects.toThrow("native-output-changed");
      await writeFile(output.path, new Uint8Array(originalBytes));
      const read = output.arrayBuffer.bind(output);
      output.arrayBuffer = async () => {
        const bytes = await read();
        await writeFile(output.path, altered);
        return bytes;
      };
      await expect(
        collectPublicArtifactManifest({
          buildId: "build-A",
          outputDirectory: join(root, "dist"),
          outputs: result.outputs,
          selected: [{ logicalName: "main", outputPath: output.path }],
        }),
      ).rejects.toThrow("native-output-changed");
      output.arrayBuffer = read;
      const target = join(root, "owned-target.js");
      await writeFile(target, new Uint8Array(originalBytes));
      await rm(output.path);
      await symlink(target, output.path);
      await expect(
        collectPublicArtifactManifest({
          buildId: "build-A",
          outputDirectory: join(root, "dist"),
          outputs: result.outputs,
          selected: [{ logicalName: "main", outputPath: output.path }],
        }),
      ).rejects.toThrow("symlink-output");
      await expect(verifyPublicArtifactFiles(input, join(root, "dist"))).rejects.toThrow(
        "symlink-output",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
