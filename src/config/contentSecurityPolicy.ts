function strictApiContentSecurityPolicy(): string {
  return "default-src 'none'; frame-ancestors 'none'; base-uri 'none'";
}

function serverHtmxContentSecurityPolicy(): string {
  return [
    "default-src 'self'",
    "script-src 'self' https://unpkg.com",
    "style-src 'self'",
    "connect-src 'self'",
    "img-src 'self'",
    "font-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
  ].join("; ");
}

function spaContentSecurityPolicy(): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "connect-src 'self'",
    "img-src 'self'",
    "font-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
  ].join("; ");
}

function resolveContentSecurityPolicy(response: Response): string {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";

  if (!contentType.includes("text/html")) {
    return strictApiContentSecurityPolicy();
  }

  const frontendMode = (process.env.FRONTEND_MODE ?? "api").trim();

  if (frontendMode === "server-htmx") {
    return serverHtmxContentSecurityPolicy();
  }

  if (frontendMode === "spa-react") {
    return spaContentSecurityPolicy();
  }

  return strictApiContentSecurityPolicy();
}

export {
  resolveContentSecurityPolicy,
  serverHtmxContentSecurityPolicy,
  spaContentSecurityPolicy,
  strictApiContentSecurityPolicy,
};
