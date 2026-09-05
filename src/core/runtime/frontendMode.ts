const FRONTEND_MODES = ["api", "server-htmx", "spa-react", "hybrid"] as const;

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

export type { FrontendMode };
export {
  FRONTEND_MODE_PATTERN,
  FRONTEND_MODES,
  isSpaEnabled,
  isSpaMode,
  isViewsEnabled,
  isViewsMode,
  parseFrontendMode,
  readFrontendMode,
};
