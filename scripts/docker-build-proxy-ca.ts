import { accessSync, constants, statSync } from "node:fs";
import { resolve } from "node:path";

/** Opt-in build input only; application/container environments never inherit this setting. */
function dockerProxyCaBuildArgs(
  environment: { STRATA_DOCKER_PROXY_CA?: string } = {
    STRATA_DOCKER_PROXY_CA: process.env.STRATA_DOCKER_PROXY_CA,
  },
): string[] {
  const configured = environment.STRATA_DOCKER_PROXY_CA;
  if (configured === undefined) return [];
  const invalid = () => new Error("STRATA_DOCKER_PROXY_CA must name a readable regular CA file.");
  if (!configured.trim()) throw invalid();
  const path = resolve(configured);
  try {
    if (!statSync(path).isFile()) throw invalid();
    accessSync(path, constants.R_OK);
  } catch {
    // Keep the supplied path and underlying filesystem details out of diagnostics.
    throw invalid();
  }
  const field = `src=${path}`;
  const source = /[,"\r\n]/.test(field) ? `"${field.replaceAll('"', '""')}"` : field;
  return ["--secret", `id=proxy_ca,${source}`];
}

export { dockerProxyCaBuildArgs };
