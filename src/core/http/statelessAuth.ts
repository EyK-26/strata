function authorizationScheme(request: Request): string {
  const header = request.headers.get("authorization")?.trim() ?? "";
  const scheme = header.split(/\s+/, 1)[0];
  return scheme ? scheme.toLowerCase() : "";
}

function requestUsesHeaderCredentials(request: Request): boolean {
  const scheme = authorizationScheme(request);
  return scheme === "bearer" || scheme === "basic";
}

function readBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization")?.trim() ?? "";

  if (!header.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

function readBasicCredentials(request: Request): { username: string; password: string } | null {
  const header = request.headers.get("authorization")?.trim() ?? "";

  if (!header.toLowerCase().startsWith("basic ")) {
    return null;
  }

  const encoded = header.slice("Basic ".length).trim();

  if (!encoded) {
    return null;
  }

  try {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const separator = decoded.indexOf(":");

    if (separator < 0) {
      return null;
    }

    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1),
    };
  } catch {
    return null;
  }
}

export { authorizationScheme, readBasicCredentials, readBearerToken, requestUsesHeaderCredentials };
