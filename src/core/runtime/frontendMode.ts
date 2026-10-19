const FRONTEND_MODES = ["api", "server-htmx", "spa-react", "hybrid"] as const;
const DEFAULT_SPA_PREFIX = "/app";

type FrontendMode = (typeof FRONTEND_MODES)[number];

const FRONTEND_MODE_PATTERN = new RegExp(`^(${FRONTEND_MODES.join("|")})$`);

function parseFrontendMode(value: string | undefined): FrontendMode {
  const mode = (value ?? "api").trim();
  if (mode === "server-htmx" || mode === "spa-react" || mode === "hybrid") {
    return mode;
  }
  return "api";
}

function readFrontendMode(): FrontendMode {
  return parseFrontendMode(process.env.FRONTEND_MODE);
}

function isViewsMode(mode: FrontendMode): boolean {
  return mode === "server-htmx" || mode === "hybrid";
}

function isSpaMode(mode: FrontendMode): boolean {
  return mode === "spa-react" || mode === "hybrid";
}

function isViewsEnabled(): boolean {
  return isViewsMode(readFrontendMode());
}

function isSpaEnabled(): boolean {
  return isSpaMode(readFrontendMode());
}

function normalizeSpaPrefix(value: string | undefined): string {
  const raw = (value ?? DEFAULT_SPA_PREFIX).trim() || DEFAULT_SPA_PREFIX;
  const withSlash = raw.startsWith("/") ? raw : `/${raw}`;
  const trimmed = withSlash.replace(/\/+$/, "");
  if (trimmed.length === 0 || trimmed === "/") {
    return DEFAULT_SPA_PREFIX;
  }
  return trimmed;
}

/** A dedicated, canonical URL namespace; API and platform probes cannot serve SPA assets. */
function validateSpaPrefix(value: string | undefined): string {
  const prefix = normalizeSpaPrefix(value);
  if (
    !/^\/[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*$/.test(prefix) ||
    prefix.split("/").some((part) => part === "." || part === "..") ||
    prefix === "/api" ||
    prefix.startsWith("/api/") ||
    prefix === "/assets" ||
    prefix.startsWith("/assets/") ||
    ["/health", "/ready", "/metrics"].includes(prefix)
  )
    throw new Error(
      "SPA_PREFIX must be a dedicated URL path outside API, assets and health/metrics routes.",
    );
  return prefix;
}

function readSpaPrefix(): string {
  return validateSpaPrefix(process.env.SPA_PREFIX);
}

export type { FrontendMode };
export {
  DEFAULT_SPA_PREFIX,
  FRONTEND_MODE_PATTERN,
  FRONTEND_MODES,
  isSpaEnabled,
  isSpaMode,
  isViewsEnabled,
  isViewsMode,
  normalizeSpaPrefix,
  parseFrontendMode,
  readFrontendMode,
  readSpaPrefix,
  validateSpaPrefix,
};
