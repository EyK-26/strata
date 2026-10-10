import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyOverlayTree, copyTree } from "../../../packages/strata-starter/src/copy";

test("installed templates and overlays never copy local dependencies or build artifacts", () => {
  const root = mkdtempSync(join(tmpdir(), "strata-copy-"));
  try {
    const source = join(root, "source");
    mkdirSync(join(source, "frontend"), { recursive: true });
    writeFileSync(join(source, "frontend", "package.json"), '{"name":"{{PROJECT_NAME}}"}');
    for (const name of ["node_modules", "dist", "coverage", ".git"]) {
      mkdirSync(join(source, "frontend", name));
      writeFileSync(join(source, "frontend", name, "local.bin"), Buffer.from([0, 255, 17]));
    }
    for (const kind of ["template", "overlay"]) {
      const target = join(root, kind);
      if (kind === "template") copyTree(source, target, "new-app");
      else copyOverlayTree(source, target);
      expect(readFileSync(join(target, "frontend", "package.json"), "utf8")).toContain(
        kind === "template" ? "new-app" : "{{PROJECT_NAME}}",
      );
      for (const name of ["node_modules", "dist", "coverage", ".git"])
        expect(existsSync(join(target, "frontend", name))).toBe(false);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
