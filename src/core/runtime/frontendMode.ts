type FrontendMode = "api" | "server-htmx" | "spa-react";

function readFrontendMode(): FrontendMode {
  const mode = (process.env.FRONTEND_MODE ?? "api").trim();

  if (mode === "server-htmx") {
    return "server-htmx";
  }

  if (mode === "spa-react") {
    return "spa-react";
  }

  return "api";
}

function isViewsEnabled(): boolean {
  return readFrontendMode() === "server-htmx";
}

function isSpaEnabled(): boolean {
  return readFrontendMode() === "spa-react";
}

export type { FrontendMode };
export { isSpaEnabled, isViewsEnabled, readFrontendMode };
