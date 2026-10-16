/** One-shot commands own only the cleanup explicitly supplied by their application. */
async function withCommandCleanup<T>(
  operation: () => Promise<T>,
  close?: () => void | Promise<void>,
): Promise<T> {
  let result: { ok: true; value: T } | { ok: false; error: unknown };
  try {
    result = { ok: true, value: await operation() };
  } catch (error) {
    result = { ok: false, error };
  }
  try {
    await close?.();
  } catch (error) {
    if (!result.ok)
      throw new AggregateError([result.error, error], "Command and application cleanup failed.", {
        cause: result.error,
      });
    throw error;
  }
  if (!result.ok) throw result.error;
  return result.value;
}

export { withCommandCleanup };
