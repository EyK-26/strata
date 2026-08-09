function resolveDefaultTokenExpiryDays(): number | null {
  const raw = process.env.API_TOKEN_DEFAULT_EXPIRY_DAYS?.trim();

  if (!raw) {
    return null;
  }

  const parsed = Number.parseInt(raw, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

export { resolveDefaultTokenExpiryDays };
