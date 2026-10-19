import { SPA_PREFIX } from "./src/config.ts";

const result = await Bun.build({
  entrypoints: ["./index.html"],
  outdir: "./dist",
  target: "browser",
  minify: true,
  publicPath: `${SPA_PREFIX}/`,
  env: "BUN_PUBLIC_*",
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }

  throw new Error("Frontend build failed.");
}

console.log(`Built ${result.outputs.length} frontend files into dist/`);
