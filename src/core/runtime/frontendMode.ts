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

function readSpaPrefix(): string {
  return normalizeSpaPrefix(process.env.SPA_PREFIX);
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
};
