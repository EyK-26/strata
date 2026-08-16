#!/usr/bin/env bun
/** Guard against bundled subpaths re-declaring shared HttpError classes. */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CORE_SHARED_SUBPATH_SET } from "./core-shared-subpaths.ts";

const ENTRIES_DIR = join(import.meta.dir, "../packages/strata-core/dist/entries");

/** Bundled entries that import @getstrata/core/errors/http and must not inline it. */
const MUST_EXTERNALIZE_ERRORS = [
  "database/errors",
  "database/model",
  "http/authorizeMiddleware",
  "http/bodySizeLimitMiddleware",
  "http/csrfMiddleware",
  "http/etag",
  "http/formRequest",
  "http/pagination",
  "http/parseFormBody",
  "http/parseMultipartUpload",
  "http/requireAbilityMiddleware",
  "http/requireAuthMiddleware",
  "http/requireGlobalAdminMiddleware",
  "http/requireWebAuthMiddleware",
  "http/securedRouteModelBinding",
  "http/webErrorResponse",
  "http/webFormRequest",
  "security/safeUrl",
  "security/stripeWebhook",
  "validation/rules",
];

const errors: string[] = [];

for (const subpath of MUST_EXTERNALIZE_ERRORS) {
  if (CORE_SHARED_SUBPATH_SET.has(subpath)) {
    continue;
  }

  const entryPath = join(ENTRIES_DIR, `${subpath}.js`);
  let source: string;

  try {
    source = await readFile(entryPath, "utf8");
  } catch {
    errors.push(`Missing bundled entry dist/entries/${subpath}.js`);
    continue;
  }

  if (source.includes("class ValidationError") || source.includes("class HttpError")) {
    errors.push(
      `dist/entries/${subpath}.js inlines HttpError classes; use @getstrata/core/errors/http self-imports`,
    );
  }
}

if (errors.length > 0) {
  console.error(`Bundled subpath verification failed:\n${errors.map((e) => `- ${e}`).join("\n")}`);
  process.exit(1);
}

console.log(`Bundled subpaths OK (${MUST_EXTERNALIZE_ERRORS.length} entries checked).`);
