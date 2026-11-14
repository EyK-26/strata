#!/usr/bin/env bun
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Composition tokens have one owner across package-root and subpath imports.
const directory = join(import.meta.dir, "../packages/strata-bootstrap/dist/entries");
await mkdir(directory, { recursive: true });
await writeFile(
  join(directory, "application.js"),
  'export { defineApp, serveApplication, APPLICATION_BILLING, APPLICATION_WEBHOOKS, APPLICATION_QUEUE } from "../index.js";\n',
);
