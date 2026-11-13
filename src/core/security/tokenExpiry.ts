function resolveDefaultTokenExpiryDays(value?: string): number | null {
  const raw = value?.trim();

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
