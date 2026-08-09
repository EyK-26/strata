/** Restore an env var after a test without writing the literal string "undefined" (Bun 1.4+). */
export function restoreEnvVar(name: string, previous: string | undefined): void {
  if (previous === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = previous;
  }
}
