function trustForwardedFor(env: Record<string, string | undefined> = process.env): boolean {
  return (env.TRUST_FORWARDED_FOR ?? "false") === "true";
}

function readClientIp(
  request: Request,
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  if (!trustForwardedFor(env)) {
    return undefined;
  }

  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();

  if (forwarded) {
    return forwarded;
  }

  return request.headers.get("x-real-ip")?.trim() || undefined;
}

export { readClientIp, trustForwardedFor };
