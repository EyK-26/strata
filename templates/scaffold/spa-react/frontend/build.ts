const result = await Bun.build({
  entrypoints: ["./index.html"],
  outdir: "./dist",
  target: "browser",
  minify: true,
  publicPath: "/app/",
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }

  throw new Error("Frontend build failed.");
}

console.log(`Built ${result.outputs.length} frontend files into dist/`);
